import crypto from 'node:crypto';
import {
  CreateJobInputSchema,
  type CreateJobInput,
  type Job,
  type JobPhase,
  type JobStatus,
  type PauseReason,
} from '../domain/jobs/job-types.js';
import type {
  CorrelationStatus,
  RemoteSubmission,
  SubmissionIntent,
} from '../domain/submissions/submission-types.js';
import { sha256Hex } from '../infrastructure/observability/redactor.js';
import { FlowDatabase } from '../infrastructure/persistence/database.js';
import { EventRepository } from '../infrastructure/persistence/repositories/event-repository.js';
import { BudgetGuard, type BudgetReservationRecord } from '../safety/budget-guard.js';
import { reduceSubmissionIntentStatus } from './state-reducers.js';

/**
 * SubmissionLedger (Arquitetura §13, §15 / BC-01, BC-05, BC-07, BC-09):
 * - Persistir intencao e reservar orcamento em transacao ANTES do envio (BC-05).
 * - Falha no banco significa nenhum clique.
 * - Marcar DISPATCHING de forma duravel imediatamente antes da acao.
 * - Se cair apos DISPATCHING, converte para UNKNOWN no startup/catch e mantem reserva HELD_UNKNOWN.
 * - Uma unica intencao de geracao por job (UNIQUE job_id em submission_intents).
 */
export class SubmissionLedger {
  private readonly flowDb: FlowDatabase;
  private readonly eventRepo: EventRepository;
  private readonly budgetGuard: BudgetGuard;

  constructor(flowDb: FlowDatabase, eventRepo: EventRepository, budgetGuard: BudgetGuard) {
    this.flowDb = flowDb;
    this.eventRepo = eventRepo;
    this.budgetGuard = budgetGuard;
  }

  public createJob(rawInput: CreateJobInput): Job {
    const input = CreateJobInputSchema.parse(rawInput);
    const jobId = input.jobId ?? crypto.randomUUID();
    const promptDigestSha256 = sha256Hex(input.prompt);
    const nowIso = new Date().toISOString();

    return this.flowDb.writeTransaction((db) => {
      db.prepare(
        `INSERT INTO jobs (
          job_id, payload_version, prompt_digest_sha256, prompt_encrypted_or_ref,
          model, aspect_ratio, requested_outputs, start_frame_path,
          project_context_id, account_context_id, completion_policy_json,
          phase, status, pause_reason, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PREFLIGHT', 'QUEUED', NULL, 1, ?, ?)`
      ).run(
        jobId,
        input.payloadVersion,
        promptDigestSha256,
        input.prompt,
        input.model,
        input.aspectRatio,
        input.requestedOutputs,
        input.startFramePath ?? null,
        input.projectContextId,
        input.accountContextId,
        JSON.stringify(input.completionPolicy),
        nowIso,
        nowIso
      );

      return this.getJobById(jobId);
    });
  }

  public getJobById(jobId: string): Job {
    return this.flowDb.read((db) => {
      const row = db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as
        | Record<string, unknown>
        | undefined;
      if (!row) {
        throw new Error(`Job '${jobId}' nao encontrado.`);
      }
      return {
        jobId: String(row.job_id),
        payloadVersion: Number(row.payload_version),
        promptDigestSha256: String(row.prompt_digest_sha256),
        promptEncryptedOrRef: String(row.prompt_encrypted_or_ref),
        model: String(row.model),
        aspectRatio: String(row.aspect_ratio),
        requestedOutputs: Number(row.requested_outputs),
        startFramePath: row.start_frame_path ? String(row.start_frame_path) : null,
        projectContextId: String(row.project_context_id),
        accountContextId: String(row.account_context_id),
        completionPolicy: JSON.parse(String(row.completion_policy_json)),
        phase: row.phase as JobPhase,
        status: row.status as JobStatus,
        pauseReason: row.pause_reason ? (row.pause_reason as PauseReason) : null,
        version: Number(row.version),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      };
    });
  }

  public updateJobState(
    jobId: string,
    phase: JobPhase,
    status: JobStatus,
    pauseReason: PauseReason | null = null
  ): Job {
    return this.flowDb.writeTransaction((db) => {
      const current = this.getJobById(jobId);
      const res = db
        .prepare(
          `UPDATE jobs
           SET phase = ?, status = ?, pause_reason = ?, version = version + 1, updated_at = ?
           WHERE job_id = ? AND version = ?`
        )
        .run(phase, status, pauseReason, new Date().toISOString(), jobId, current.version);
      if (res.changes !== 1) {
        throw new Error(`Conflito de concorrencia otimista ao atualizar job '${jobId}'.`);
      }
      return this.getJobById(jobId);
    });
  }

  /**
   * Passo 3 do Protocolo de Submissao (Arquitetura §13 / BC-05):
   * Em uma unica transacao: cria tentativa, cria SubmissionIntent(RESERVED), reserva orcamento e grava evento.
   * Se falhar o commit no banco -> 0 cliques ocorrem!
   */
  public createIntentAndReserveBudget(params: {
    jobId: string;
    controllerEpoch: number;
    observedConfigDigest: string;
    baselineSnapshot: Record<string, unknown>;
    policyVersion: string;
    registryVersion: string;
    nowMs?: number;
  }): { intent: SubmissionIntent; reservation: BudgetReservationRecord } {
    return this.flowDb.writeTransaction((db) => {
      const job = this.getJobById(params.jobId);

      // Verificar se ja existe intencao para este job (proibida regeneracao automatica — Arquitetura §11)
      const existingIntent = db
        .prepare('SELECT submission_intent_id, status FROM submission_intents WHERE job_id = ?')
        .get(params.jobId) as { submission_intent_id: string; status: string } | undefined;

      if (existingIntent) {
        throw new Error(
          `Job '${params.jobId}' ja possui SubmissionIntent '${existingIntent.submission_intent_id}' (status=${existingIntent.status}). Proibido criar reenvio automatico (BC-07).`
        );
      }

      const maxAtt = db
        .prepare('SELECT COALESCE(MAX(attempt_number), 0) as m FROM job_attempts WHERE job_id = ?')
        .get(params.jobId) as { m: number };
      const attemptId = `att_${crypto.randomUUID()}`;
      const nowIso = new Date(params.nowMs ?? Date.now()).toISOString();

      db.prepare(
        `INSERT INTO job_attempts (
          attempt_id, job_id, attempt_number, controller_epoch, status, started_at
        ) VALUES (?, ?, ?, ?, 'STARTED', ?)`
      ).run(attemptId, params.jobId, Number(maxAtt.m) + 1, params.controllerEpoch, nowIso);

      const submissionIntentId = `int_${crypto.randomUUID()}`;
      const baselineJson = JSON.stringify(params.baselineSnapshot);

      db.prepare(
        `INSERT INTO submission_intents (
          submission_intent_id, job_id, attempt_id, status,
          observed_config_digest, baseline_snapshot_json, version, created_at, updated_at
        ) VALUES (?, ?, ?, 'RESERVED', ?, ?, 1, ?, ?)`
      ).run(
        submissionIntentId,
        params.jobId,
        attemptId,
        params.observedConfigDigest,
        baselineJson,
        nowIso,
        nowIso
      );

      const reservation = this.budgetGuard.reserveWithinTransaction(db, {
        submissionIntentId,
        jobId: params.jobId,
        accountContextId: job.accountContextId,
        projectContextId: job.projectContextId,
        requestedOutputs: job.requestedOutputs,
        nowMs: params.nowMs,
      });

      db.prepare(
        `UPDATE jobs SET phase = 'SUBMITTING', status = 'ACTIVE', version = version + 1, updated_at = ?
         WHERE job_id = ?`
      ).run(nowIso, params.jobId);

      this.eventRepo.insertWithinTransaction(db, {
        eventType: 'action.planned',
        correlationId: submissionIntentId,
        jobId: params.jobId,
        controllerEpoch: params.controllerEpoch,
        policyVersion: params.policyVersion,
        registryVersion: params.registryVersion,
        reason: 'SubmissionIntent criada e orcamento reservado atomicamente (RESERVED)',
        payload: { submissionIntentId, reservationId: reservation.reservationId },
      });

      return {
        intent: this.getIntentById(submissionIntentId),
        reservation,
      };
    });
  }

  public abortBeforeDispatch(
    submissionIntentId: string,
    reason: string,
    controllerEpoch: number
  ): SubmissionIntent {
    return this.flowDb.writeTransaction((db) => {
      const current = this.getIntentById(submissionIntentId);
      const nextStatus = reduceSubmissionIntentStatus(current.status, 'ABORTED', reason);
      const nowIso = new Date().toISOString();

      db.prepare(
        `UPDATE submission_intents
         SET status = ?, version = version + 1, updated_at = ?
         WHERE submission_intent_id = ? AND version = ?`
      ).run(nextStatus, nowIso, submissionIntentId, current.version);

      // Como o clique comprovadamente NAO ocorreu (ainda estava em PLANNED/RESERVED), libera a reserva
      this.budgetGuard.markReservationStatusWithinTransaction(
        db,
        submissionIntentId,
        'RELEASED_ABORTED'
      );

      db.prepare(
        `UPDATE jobs SET status = 'PAUSED', pause_reason = 'POLICY', updated_at = ? WHERE job_id = ?`
      ).run(nowIso, current.jobId);

      this.eventRepo.insertWithinTransaction(db, {
        eventType: 'action.denied',
        correlationId: submissionIntentId,
        jobId: current.jobId,
        controllerEpoch,
        policyVersion: '1.0.0',
        registryVersion: 'ACTIVE',
        reason: `Intencao abortada antes do disparo: ${reason}`,
        payload: { submissionIntentId },
      });

      return this.getIntentById(submissionIntentId);
    });
  }

  /**
   * Passo 6 do Protocolo de Submissao (Arquitetura §13):
   * Persiste DISPATCHING de forma duravel imediatamente antes do clique.
   */
  public markDispatchingBeforeClick(submissionIntentId: string): SubmissionIntent {
    return this.flowDb.writeTransaction((db) => {
      const current = this.getIntentById(submissionIntentId);
      const nextStatus = reduceSubmissionIntentStatus(
        current.status,
        'DISPATCHING',
        'Pronto para disparar clique unico de submissao'
      );

      db.prepare(
        `UPDATE submission_intents
         SET status = ?, version = version + 1, updated_at = ?
         WHERE submission_intent_id = ? AND version = ?`
      ).run(nextStatus, new Date().toISOString(), submissionIntentId, current.version);

      return this.getIntentById(submissionIntentId);
    });
  }

  /**
   * Passo 9 do Protocolo de Submissao (Arquitetura §13):
   * Persiste correlacao e CONFIRMED em transacao.
   */
  public confirmSubmission(params: {
    submissionIntentId: string;
    scopeId: string;
    remoteExternalId: string;
    controllerEpoch: number;
    policyVersion: string;
    registryVersion: string;
    ruleApplied: string;
  }): { intent: SubmissionIntent; remoteSubmission: RemoteSubmission } {
    return this.flowDb.writeTransaction((db) => {
      const current = this.getIntentById(params.submissionIntentId);
      const nextStatus = reduceSubmissionIntentStatus(
        current.status,
        'CONFIRMED',
        params.ruleApplied
      );
      const nowIso = new Date().toISOString();

      db.prepare(
        `UPDATE submission_intents
         SET status = ?, version = version + 1, updated_at = ?
         WHERE submission_intent_id = ? AND version = ?`
      ).run(nextStatus, nowIso, params.submissionIntentId, current.version);

      this.budgetGuard.markReservationStatusWithinTransaction(
        db,
        params.submissionIntentId,
        'CONSUMED'
      );

      const remoteSubmissionId = `rsub_${crypto.randomUUID()}`;
      db.prepare(
        `INSERT INTO remote_submissions (
          remote_submission_id, submission_intent_id, scope_id,
          remote_external_id, correlation_status, observed_at
        ) VALUES (?, ?, ?, ?, 'CONFIRMED', ?)`
      ).run(
        remoteSubmissionId,
        params.submissionIntentId,
        params.scopeId,
        params.remoteExternalId,
        nowIso
      );

      db.prepare(
        `UPDATE jobs SET phase = 'AWAITING_RESULTS', status = 'ACTIVE', updated_at = ?
         WHERE job_id = ?`
      ).run(nowIso, current.jobId);

      this.eventRepo.insertWithinTransaction(db, {
        eventType: 'correlation.decided',
        correlationId: params.submissionIntentId,
        jobId: current.jobId,
        controllerEpoch: params.controllerEpoch,
        policyVersion: params.policyVersion,
        registryVersion: params.registryVersion,
        reason: `Submissao confirmada com ID remoto ${params.remoteExternalId}`,
        payload: {
          submissionIntentId: params.submissionIntentId,
          remoteSubmissionId,
          remoteExternalId: params.remoteExternalId,
          outcome: 'CONFIRMED' as CorrelationStatus,
        },
      });

      return {
        intent: this.getIntentById(params.submissionIntentId),
        remoteSubmission: {
          remoteSubmissionId,
          submissionIntentId: params.submissionIntentId,
          scopeId: params.scopeId,
          remoteExternalId: params.remoteExternalId,
          correlationStatus: 'CONFIRMED',
          observedAt: nowIso,
        },
      };
    });
  }

  /**
   * Passo 10 do Protocolo de Submissao (Arquitetura §13 / BC-07):
   * Qualquer falha entre o passo 6 (DISPATCHING) e o passo 9 (CONFIRMED) classifica como UNKNOWN,
   * mantem a reserva de orcamento (HELD_UNKNOWN) e pausa o job em UNKNOWN_STATE.
   */
  public markUnknownOnPostDispatchFailure(params: {
    submissionIntentId: string;
    reason: string;
    controllerEpoch: number;
    policyVersion: string;
    registryVersion: string;
  }): SubmissionIntent {
    return this.flowDb.writeTransaction((db) => {
      const current = this.getIntentById(params.submissionIntentId);
      const nextStatus =
        current.status === 'UNKNOWN'
          ? 'UNKNOWN'
          : reduceSubmissionIntentStatus(current.status, 'UNKNOWN', params.reason);
      const nowIso = new Date().toISOString();

      db.prepare(
        `UPDATE submission_intents
         SET status = ?, version = version + 1, updated_at = ?
         WHERE submission_intent_id = ?`
      ).run(nextStatus, nowIso, params.submissionIntentId);

      this.budgetGuard.markReservationStatusWithinTransaction(
        db,
        params.submissionIntentId,
        'HELD_UNKNOWN'
      );

      db.prepare(
        `UPDATE jobs
         SET status = 'PAUSED', pause_reason = 'UNKNOWN_STATE', updated_at = ?
         WHERE job_id = ?`
      ).run(nowIso, current.jobId);

      this.eventRepo.insertWithinTransaction(db, {
        eventType: 'submission.unknown',
        correlationId: params.submissionIntentId,
        jobId: current.jobId,
        controllerEpoch: params.controllerEpoch,
        policyVersion: params.policyVersion,
        registryVersion: params.registryVersion,
        reason: params.reason,
        payload: { submissionIntentId: params.submissionIntentId },
      });

      return this.getIntentById(params.submissionIntentId);
    });
  }

  /**
   * No startup, qualquer SubmissionIntent que tenha ficado em DISPATCHING (queda de energia/kill -9)
   * e convertida imediatamente para UNKNOWN com HELD_UNKNOWN.
   */
  public recoverInFlightIntentsOnStartup(controllerEpoch: number): SubmissionIntent[] {
    const rows = this.flowDb.read((db) =>
      db
        .prepare(
          "SELECT submission_intent_id FROM submission_intents WHERE status = 'DISPATCHING'"
        )
        .all() as Array<{ submission_intent_id: string }>
    );

    const recovered: SubmissionIntent[] = [];
    for (const r of rows) {
      recovered.push(
        this.markUnknownOnPostDispatchFailure({
          submissionIntentId: r.submission_intent_id,
          reason: 'Processo encerrado enquanto SubmissionIntent estava em DISPATCHING',
          controllerEpoch,
          policyVersion: '1.0.0',
          registryVersion: 'STARTUP_RECOVERY',
        })
      );
    }
    return recovered;
  }

  public getIntentById(submissionIntentId: string): SubmissionIntent {
    return this.flowDb.read((db) => {
      const row = db
        .prepare('SELECT * FROM submission_intents WHERE submission_intent_id = ?')
        .get(submissionIntentId) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error(`SubmissionIntent '${submissionIntentId}' nao encontrada.`);
      }
      return {
        submissionIntentId: String(row.submission_intent_id),
        jobId: String(row.job_id),
        attemptId: String(row.attempt_id),
        status: row.status as SubmissionIntent['status'],
        observedConfigDigest: String(row.observed_config_digest),
        baselineSnapshotJson: String(row.baseline_snapshot_json),
        version: Number(row.version),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      };
    });
  }

  public getIntentByJobId(jobId: string): SubmissionIntent | null {
    return this.flowDb.read((db) => {
      const row = db
        .prepare('SELECT submission_intent_id FROM submission_intents WHERE job_id = ?')
        .get(jobId) as { submission_intent_id: string } | undefined;
      if (!row) return null;
      return this.getIntentById(row.submission_intent_id);
    });
  }
}
