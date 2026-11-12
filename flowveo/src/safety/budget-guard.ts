import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { FlowDatabase } from '../infrastructure/persistence/database.js';
import type { PolicyConfig } from '../shared/config-schema.js';
import { PolicyDeniedError } from '../shared/errors.js';

export interface ReserveBudgetInput {
  submissionIntentId: string;
  jobId: string;
  accountContextId: string;
  projectContextId: string;
  requestedOutputs: number;
  nowMs?: number;
}

export interface BudgetReservationRecord {
  reservationId: string;
  submissionIntentId: string;
  jobId: string;
  accountContextId: string;
  projectContextId: string;
  requestedOutputs: number;
  status: 'RESERVED' | 'CONSUMED' | 'HELD_UNKNOWN' | 'RELEASED_ABORTED';
}

/**
 * BudgetGuard (Arquitetura §16 / BC-05, BC-09, S-05):
 * - Limites persistentes no SQLite que sobrevivem a reinicios do processo.
 * - Reserva antes do envio.
 * - Estado UNKNOWN mantem a reserva ativa (HELD_UNKNOWN) indefinidamente ate decisao explicita;
 *   JAMAIS libera reserva por timeout.
 */
export class BudgetGuard {
  private readonly flowDb: FlowDatabase;
  private readonly policy: PolicyConfig;
  private runSubmissionsCount = 0;
  private runRequestedOutputsCount = 0;

  constructor(flowDb: FlowDatabase, policy: PolicyConfig) {
    this.flowDb = flowDb;
    this.policy = policy;
  }

  /**
   * Reserva limite dentro de uma transacao SQLite existente (para atomicidade com a criacao da SubmissionIntent).
   */
  public reserveWithinTransaction(
    db: DatabaseSync,
    input: ReserveBudgetInput
  ): BudgetReservationRecord {
    const nowMs = input.nowMs ?? Date.now();
    const windowStartCutoff = nowMs - this.policy.limits.windowDurationMs;

    // Contar todas as reservas que consomem orcamento na janela (RESERVED, CONSUMED e HELD_UNKNOWN!)
    const windowStats = db
      .prepare(
        `SELECT
          COUNT(*) as active_submissions,
          COALESCE(SUM(requested_outputs), 0) as active_outputs
         FROM budget_reservations
         WHERE status IN ('RESERVED', 'CONSUMED', 'HELD_UNKNOWN')
           AND created_at_ms >= ?`
      )
      .get(windowStartCutoff) as { active_submissions: number; active_outputs: number };

    // Tambem verificar se existem reservas HELD_UNKNOWN que esgotam o limite por run mesmo apos restart!
    const heldUnknownOrReserved = db
      .prepare(
        `SELECT
          COUNT(*) as held_count,
          COALESCE(SUM(requested_outputs), 0) as held_outputs
         FROM budget_reservations
         WHERE status IN ('RESERVED', 'HELD_UNKNOWN')`
      )
      .get() as { held_count: number; held_outputs: number };

    const effectiveRunSubmissions = Math.max(
      this.runSubmissionsCount,
      Number(heldUnknownOrReserved.held_count)
    );
    const effectiveRunOutputs = Math.max(
      this.runRequestedOutputsCount,
      Number(heldUnknownOrReserved.held_outputs)
    );

    if (effectiveRunSubmissions + 1 > this.policy.limits.maxSubmissionsPerRun) {
      throw new PolicyDeniedError(
        `Limite de submissoes por run atingido (${effectiveRunSubmissions}/${this.policy.limits.maxSubmissionsPerRun}) — incluindo reservas UNKNOWN ativas (BC-09).`
      );
    }

    if (
      effectiveRunOutputs + input.requestedOutputs >
      this.policy.limits.maxRequestedOutputsPerRun
    ) {
      throw new PolicyDeniedError(
        `Limite de saidas solicitadas por run excedido (${effectiveRunOutputs + input.requestedOutputs}/${this.policy.limits.maxRequestedOutputsPerRun}).`
      );
    }

    if (Number(windowStats.active_submissions) + 1 > this.policy.limits.maxSubmissionsPerWindow) {
      throw new PolicyDeniedError(
        `Limite persistente por janela temporal atingido (${windowStats.active_submissions}/${this.policy.limits.maxSubmissionsPerWindow} — BC-09).`
      );
    }

    const reservationId = `res_${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO budget_reservations (
        reservation_id, submission_intent_id, job_id,
        account_context_id, project_context_id,
        requested_outputs, status, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?)`
    ).run(
      reservationId,
      input.submissionIntentId,
      input.jobId,
      input.accountContextId,
      input.projectContextId,
      input.requestedOutputs,
      nowMs,
      nowMs
    );

    this.runSubmissionsCount += 1;
    this.runRequestedOutputsCount += input.requestedOutputs;

    return {
      reservationId,
      submissionIntentId: input.submissionIntentId,
      jobId: input.jobId,
      accountContextId: input.accountContextId,
      projectContextId: input.projectContextId,
      requestedOutputs: input.requestedOutputs,
      status: 'RESERVED',
    };
  }

  public markReservationStatusWithinTransaction(
    db: DatabaseSync,
    submissionIntentId: string,
    status: 'CONSUMED' | 'HELD_UNKNOWN' | 'RELEASED_ABORTED'
  ): void {
    db.prepare(
      `UPDATE budget_reservations
       SET status = ?, updated_at_ms = ?
       WHERE submission_intent_id = ?`
    ).run(status, Date.now(), submissionIntentId);
  }

  public getReservationByIntent(submissionIntentId: string): BudgetReservationRecord | null {
    return this.flowDb.read((db) => {
      const row = db
        .prepare(
          `SELECT reservation_id, submission_intent_id, job_id,
                  account_context_id, project_context_id, requested_outputs, status
           FROM budget_reservations WHERE submission_intent_id = ?`
        )
        .get(submissionIntentId) as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        reservationId: String(row.reservation_id),
        submissionIntentId: String(row.submission_intent_id),
        jobId: String(row.job_id),
        accountContextId: String(row.account_context_id),
        projectContextId: String(row.project_context_id),
        requestedOutputs: Number(row.requested_outputs),
        status: row.status as BudgetReservationRecord['status'],
      };
    });
  }
}
