import { ExecutionService } from '../application/execution-service.js';
import { RecoveryService } from '../application/recovery-service.js';
import type { Job } from '../domain/jobs/job-types.js';
import { FlowDatabase } from '../infrastructure/persistence/database.js';
import { CircuitBreaker } from '../safety/circuit-breaker.js';
import { StopController } from '../safety/stop-controller.js';
import { PolicyDeniedError } from '../shared/errors.js';
import { SubmissionLedger } from './submission-ledger.js';

export interface BatchExecutionSummary {
  requestedJobIds: string[];
  processedJobIds: string[];
  completedJobIds: string[];
  partialJobIds: string[];
  haltedJobId: string | null;
  haltReason: string | null;
}

/**
 * JobOrchestrator (Arquitetura §11, §20 / BC-17, BC-18):
 * - Executa lotes pequenos de forma estritamente serial (maxConcurrentJobs === 1).
 * - Para imediatamente o lote se um job entrar em UNKNOWN, PAUSED, NEEDS_REVIEW ou se CircuitBreaker abrir.
 * - cancelJobLocally marca o Job como CANCELLED_LOCAL mas preserva SubmissionIntent e BudgetReservation
 *   quando o envio ja tiver entrado em DISPATCHING, UNKNOWN ou CONFIRMED (BC-17).
 */
export class JobOrchestrator {
  private readonly flowDb: FlowDatabase;
  private readonly ledger: SubmissionLedger;
  private readonly executionService: ExecutionService;
  private readonly recoveryService: RecoveryService;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly stopController: StopController;
  private isBatchRunning = false;

  constructor(params: {
    flowDb: FlowDatabase;
    ledger: SubmissionLedger;
    executionService: ExecutionService;
    recoveryService: RecoveryService;
    circuitBreaker: CircuitBreaker;
    stopController: StopController;
  }) {
    this.flowDb = params.flowDb;
    this.ledger = params.ledger;
    this.executionService = params.executionService;
    this.recoveryService = params.recoveryService;
    this.circuitBreaker = params.circuitBreaker;
    this.stopController = params.stopController;
  }

  /**
   * Executa uma lista de jobs de forma estritamente serial (1 por vez — BC-18).
   */
  public async runSerialBatch(
    jobIds: string[],
    controllerEpoch = 1
  ): Promise<BatchExecutionSummary> {
    if (this.isBatchRunning) {
      throw new PolicyDeniedError(
        'Execucao concorrente de lotes proibida (maxConcurrentJobs === 1 — BC-18).'
      );
    }

    this.isBatchRunning = true;
    const processedJobIds: string[] = [];
    const completedJobIds: string[] = [];
    const partialJobIds: string[] = [];
    let haltedJobId: string | null = null;
    let haltReason: string | null = null;

    try {
      for (const jobId of jobIds) {
        if (this.stopController.isStopped()) {
          haltedJobId = jobId;
          haltReason = `StopController acionado: ${this.stopController.getStatus().reason}`;
          break;
        }

        try {
          this.circuitBreaker.assertClosedOrThrow();
        } catch (cbErr) {
          haltedJobId = jobId;
          haltReason = cbErr instanceof Error ? cbErr.message : String(cbErr);
          break;
        }

        processedJobIds.push(jobId);

        try {
          await this.executionService.prepareJob(jobId);
          const subRes = await this.executionService.executeSingleSubmission(jobId);

          if (subRes.outcomeStatus !== 'CONFIRMED') {
            this.circuitBreaker.recordFailure({
              reason: `Submissao terminou em ${subRes.outcomeStatus}`,
              immediateTrip: true,
              controllerEpoch,
              jobId,
            });
            haltedJobId = jobId;
            haltReason = `Parada imediata por estado incerto/ambiguo (${subRes.outcomeStatus} — stopOnUnknownState=true).`;
            break;
          }

          const collectRes = await this.recoveryService.collectAndVerifyJobResults(jobId);
          if (collectRes.job.status === 'COMPLETED') {
            completedJobIds.push(jobId);
            this.circuitBreaker.recordSuccess();
          } else if (collectRes.job.status === 'PARTIAL') {
            partialJobIds.push(jobId);
            this.circuitBreaker.recordSuccess();
          } else {
            this.circuitBreaker.recordFailure({
              reason: `Coleta do job '${jobId}' terminou em ${collectRes.job.status}`,
              immediateTrip: collectRes.job.status === 'NEEDS_REVIEW',
              controllerEpoch,
              jobId,
            });
            haltedJobId = jobId;
            haltReason = `Job '${jobId}' nao concluiu com sucesso (status=${collectRes.job.status}).`;
            break;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.circuitBreaker.recordFailure({
            reason: msg,
            immediateTrip: false,
            controllerEpoch,
            jobId,
          });
          haltedJobId = jobId;
          haltReason = msg;
          break;
        }
      }

      return {
        requestedJobIds: jobIds,
        processedJobIds,
        completedJobIds,
        partialJobIds,
        haltedJobId,
        haltReason,
      };
    } finally {
      this.isBatchRunning = false;
    }
  }

  /**
   * Cancelamento Local Seguro (Arquitetura §11 / BC-17):
   * Interrompe acoes locais futuras do job (marca CANCELLED_LOCAL), mas JAMAIS apaga
   * SubmissionIntent nem libera BudgetReservation se o envio ja tiver entrado em
   * DISPATCHING, UNKNOWN ou CONFIRMED (pois a geracao remota pode continuar no servidor).
   */
  public cancelJobLocally(jobId: string, reason = 'Cancelado localmente pelo operador'): Job {
    return this.flowDb.writeTransaction((db) => {
      const job = this.ledger.getJobById(jobId);
      const intent = this.ledger.getIntentByJobId(jobId);
      const nowIso = new Date().toISOString();

      if (intent && (intent.status === 'PLANNED' || intent.status === 'RESERVED')) {
        // Como o clique comprovadamente ainda nao entrou em DISPATCHING, podemos abortar a intencao
        db.prepare(
          `UPDATE submission_intents SET status = 'ABORTED', version = version + 1, updated_at = ?
           WHERE submission_intent_id = ?`
        ).run(nowIso, intent.submissionIntentId);

        db.prepare(
          `UPDATE budget_reservations SET status = 'RELEASED_ABORTED', updated_at_ms = ?
           WHERE submission_intent_id = ?`
        ).run(Date.now(), intent.submissionIntentId);
      }
      // Se intent.status for DISPATCHING, UNKNOWN, RECONCILING, NEEDS_REVIEW ou CONFIRMED:
      // preserva intactos a SubmissionIntent e a BudgetReservation para futura reconciliacao (BC-17)!

      db.prepare(
        `UPDATE jobs
         SET status = 'CANCELLED_LOCAL', pause_reason = 'USER', version = version + 1, updated_at = ?
         WHERE job_id = ? AND version = ?`
      ).run(nowIso, jobId, job.version);

      void reason;
      return this.ledger.getJobById(jobId);
    });
  }
}
