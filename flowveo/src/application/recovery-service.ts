import type { ArtifactRecord } from '../domain/artifacts/artifact-types.js';
import type { Job } from '../domain/jobs/job-types.js';
import { evaluateJobCompletionStatus } from '../execution/state-reducers.js';
import { SubmissionLedger } from '../execution/submission-ledger.js';
import type { ActionPlanner, AuthorizedExecutor, FlowReader, SafetyGateway } from '../flow/contracts.js';
import { ArtifactStore } from '../infrastructure/artifacts/artifact-store.js';
import { DownloadVerifier } from '../infrastructure/artifacts/download-verifier.js';
import {
  LocalArtifactReconciler,
  type LocalReconciliationReport,
} from '../infrastructure/artifacts/local-reconciler.js';
import { FlowDatabase } from '../infrastructure/persistence/database.js';
import { PermitStore } from '../safety/permit-store.js';
import { PolicyDeniedError } from '../shared/errors.js';

export type DownloadStreamProvider = (remoteResultId: string, attempt: number) => Promise<{
  suggestedFilename: string;
  bytes: Buffer;
}>;

export interface ResumeJobOutcome {
  job: Job;
  verifiedArtifacts: ArtifactRecord[];
  downloadAttemptsByResult: Record<string, number>;
  submissionClicksTriggered: 0;
}

/**
 * RecoveryService (Arquitetura §18, §20 / OBJ-05, OBJ-06, BC-12, BC-13, BC-16):
 * - Retoma jobs interrompidos invalidando permissoes antigas e reconciliando estado real.
 * - Suporta salto direto OBSERVED -> READY sem depender de PROCESSING (BC-12).
 * - Rebaixa apenas a acao de DOWNLOAD do mesmo remoteResultId em caso de falha de rede/arquivo truncado;
 *   JAMAIS cria nova SubmissionIntent ou regenera video para corrigir falha de download (BC-16).
 */
export class RecoveryService {
  private readonly flowDb: FlowDatabase;
  private readonly ledger: SubmissionLedger;
  private readonly permitStore: PermitStore;
  private readonly artifactStore: ArtifactStore;
  private readonly verifier: DownloadVerifier;
  private readonly localReconciler: LocalArtifactReconciler;
  private readonly reader: FlowReader;
  private readonly planner: ActionPlanner;
  private readonly safetyGateway: SafetyGateway;
  private readonly executor: AuthorizedExecutor;
  private readonly downloadProvider: DownloadStreamProvider;
  private readonly maxDownloadRetries: number;
  private readonly registryVersion: string;
  private readonly policyVersion: string;

  constructor(params: {
    flowDb: FlowDatabase;
    ledger: SubmissionLedger;
    permitStore: PermitStore;
    artifactStore: ArtifactStore;
    verifier: DownloadVerifier;
    localReconciler: LocalArtifactReconciler;
    reader: FlowReader;
    planner: ActionPlanner;
    safetyGateway: SafetyGateway;
    executor: AuthorizedExecutor;
    downloadProvider: DownloadStreamProvider;
    maxDownloadRetries?: number;
    registryVersion: string;
    policyVersion: string;
  }) {
    this.flowDb = params.flowDb;
    this.ledger = params.ledger;
    this.permitStore = params.permitStore;
    this.artifactStore = params.artifactStore;
    this.verifier = params.verifier;
    this.localReconciler = params.localReconciler;
    this.reader = params.reader;
    this.planner = params.planner;
    this.safetyGateway = params.safetyGateway;
    this.executor = params.executor;
    this.downloadProvider = params.downloadProvider;
    this.maxDownloadRetries = params.maxDownloadRetries ?? 2;
    this.registryVersion = params.registryVersion;
    this.policyVersion = params.policyVersion;
  }

  public reconcileLocalArtifacts(): LocalReconciliationReport {
    return this.localReconciler.reconcile();
  }

  /**
   * Coleta e verifica todos os resultados remotos prontos de uma submissao confirmada,
   * realizando retry exclusivo de DOWNLOAD sobre o mesmo remoteResultId (BC-16).
   */
  public async collectAndVerifyJobResults(jobId: string): Promise<ResumeJobOutcome> {
    const job = this.ledger.getJobById(jobId);
    const intent = this.ledger.getIntentByJobId(jobId);
    if (!intent || intent.status !== 'CONFIRMED') {
      throw new PolicyDeniedError(
        `Job '${jobId}' nao possui SubmissionIntent CONFIRMED para coleta de resultados.`
      );
    }

    const remoteSub = this.flowDb.read((db) =>
      db
        .prepare('SELECT * FROM remote_submissions WHERE submission_intent_id = ?')
        .get(intent.submissionIntentId) as
        | { remote_submission_id: string; remote_external_id: string }
        | undefined
    );
    if (!remoteSub) {
      throw new PolicyDeniedError(
        `RemoteSubmission ausente para SubmissionIntent '${intent.submissionIntentId}'.`
      );
    }

    // 1. Inspecionar resultados atuais na pagina e atualizar remote_results (incluindo salto OBSERVED -> READY — BC-12)
    const obs = await this.reader.inspectResults();
    for (const item of obs.items) {
      if (
        item.remoteExternalId === remoteSub.remote_external_id ||
        obs.items.length <= job.requestedOutputs
      ) {
        this.artifactStore.upsertRemoteResult({
          remoteSubmissionId: remoteSub.remote_submission_id,
          resultIndex: item.resultIndex,
          remoteAssetId: item.remoteAssetId,
          status: item.status,
        });
      }
    }

    const dbResults = this.flowDb.read((db) =>
      db
        .prepare(
          'SELECT remote_result_id, result_index, status FROM remote_results WHERE remote_submission_id = ? ORDER BY result_index ASC'
        )
        .all(remoteSub.remote_submission_id) as Array<{
        remote_result_id: string;
        result_index: number;
        status: 'OBSERVED' | 'PROCESSING' | 'READY' | 'FAILED_REMOTE' | 'UNKNOWN';
      }>
    );

    this.ledger.updateJobState(jobId, 'COLLECTING', 'ACTIVE');

    const downloadAttemptsByResult: Record<string, number> = {};
    const maxTotalAttempts = 1 + this.maxDownloadRetries;

    for (const r of dbResults) {
      if (r.status !== 'READY') continue;

      // Verificar se ja existe artefato VERIFIED para este remote_result_id
      const existingVerified = this.artifactStore
        .listArtifactsByJob(jobId)
        .find((a) => a.remoteResultId === r.remote_result_id && a.status === 'VERIFIED');
      if (existingVerified) {
        downloadAttemptsByResult[r.remote_result_id] = 0;
        continue;
      }

      let verified = false;
      for (let attempt = 1; attempt <= maxTotalAttempts; attempt++) {
        downloadAttemptsByResult[r.remote_result_id] = attempt;

        const ctx = await this.reader.inspectContext();
        const dlPlan = this.planner.plan(
          {
            mode: 'execute',
            actionKind: 'DOWNLOAD',
            targetControlId: `ctrl_download_${r.result_index}`,
            transitionId: 'tr_download_result',
            paramsCanonical: {
              remoteResultId: r.remote_result_id,
              resultIndex: r.result_index,
              attempt,
            },
            jobId: job.jobId,
            attemptId: intent.attemptId,
            submissionIntentId: intent.submissionIntentId,
            registryVersion: this.registryVersion,
            policyVersion: this.policyVersion,
            observedConfigDigest: intent.observedConfigDigest,
          },
          ctx
        );

        const decision = await this.safetyGateway.authorize(dlPlan, ctx);
        if (!decision.allowed) {
          throw new PolicyDeniedError(decision.reason, { code: decision.code });
        }

        const plannedArtifact = this.artifactStore.planArtifactDownload({
          jobId: job.jobId,
          submissionIntentId: intent.submissionIntentId,
          remoteSubmissionId: remoteSub.remote_submission_id,
          remoteResultId: r.remote_result_id,
          downloadPermitId: decision.permit.permitId,
          remoteSuggestedFilename: `result_${r.result_index}.mp4`,
          expectedExtension: job.completionPolicy.technicalRequirements.expectedContainer,
        });

        try {
          await this.executor.execute(decision.permit.permitId);
          const streamData = await this.downloadProvider(r.remote_result_id, attempt);
          this.artifactStore.writeStagingPart(plannedArtifact.artifactId, streamData.bytes);
          this.artifactStore.finalizeStagingToDownloaded(plannedArtifact.artifactId);

          const verification = await this.verifier.verifyDownloadedArtifact(
            plannedArtifact.artifactId,
            job.completionPolicy
          );
          if (verification.artifact.status === 'VERIFIED') {
            verified = true;
            break;
          }
        } catch {
          // Se falhou em staging/rede antes de DOWNLOADED, permanece para reconciliacao e tenta proximo retry de DOWNLOAD do mesmo remoteResultId
        }
      }
      void verified;
    }

    this.ledger.updateJobState(jobId, 'VERIFYING', 'ACTIVE');

    const allArtifacts = this.artifactStore.listArtifactsByJob(jobId);
    const verifiedArtifacts = allArtifacts.filter((a) => a.status === 'VERIFIED');
    const failedOrRejectedCount = dbResults.filter((r) => {
      if (r.status === 'FAILED_REMOTE') return true;
      const hasVerified = verifiedArtifacts.some((a) => a.remoteResultId === r.remote_result_id);
      return !hasVerified && r.status === 'READY';
    }).length;
    const inProgressCount = dbResults.filter(
      (r) => r.status === 'OBSERVED' || r.status === 'PROCESSING'
    ).length;
    const unknownCount = dbResults.filter((r) => r.status === 'UNKNOWN').length;

    const finalJobStatus =
      unknownCount > 0
        ? 'NEEDS_REVIEW'
        : inProgressCount > 0
          ? 'ACTIVE'
          : evaluateJobCompletionStatus({
              policy: job.completionPolicy,
              requestedOutputs: job.requestedOutputs,
              verifiedArtifactsCount: verifiedArtifacts.length,
              failedOrRejectedCount,
            });

    const finalPhase =
      finalJobStatus === 'COMPLETED' || finalJobStatus === 'PARTIAL' || finalJobStatus === 'FAILED'
        ? 'DONE'
        : 'VERIFYING';

    const updatedJob = this.ledger.updateJobState(jobId, finalPhase, finalJobStatus);
    return {
      job: updatedJob,
      verifiedArtifacts,
      downloadAttemptsByResult,
      submissionClicksTriggered: 0,
    };
  }
}
