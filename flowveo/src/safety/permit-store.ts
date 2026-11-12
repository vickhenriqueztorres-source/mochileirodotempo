import crypto from 'node:crypto';
import type {
  ActionOutcome,
  ActionPlan,
  ExecutionPermit,
  PermitStatus,
} from '../domain/actions/action-types.js';
import type { ContextSnapshot } from '../flow/contracts.js';
import { FlowDatabase } from '../infrastructure/persistence/database.js';
import { EventRepository } from '../infrastructure/persistence/repositories/event-repository.js';
import { PermitInvalidError } from '../shared/errors.js';

export interface IssuePermitMeta {
  controllerEpoch: number;
  sessionEpoch: number;
  pageId: string;
  ttlMs: number;
  nowWallMs?: number;
  nowMonotonicNs?: bigint;
}

export interface ClaimPermitRuntimeContext {
  controllerEpoch: number;
  sessionEpoch: number;
  pageId: string;
  projectContextId: string;
  accountContextId: string;
  registryVersion: string;
  policyVersion: string;
  observedConfigDigest: string;
  observedRevision: number;
  nowWallMs?: number;
  nowMonotonicNs?: bigint;
}

export class PermitStore {
  private readonly flowDb: FlowDatabase;
  private readonly eventRepo: EventRepository;

  constructor(flowDb: FlowDatabase, eventRepo: EventRepository) {
    this.flowDb = flowDb;
    this.eventRepo = eventRepo;
  }

  public issuePermit(plan: ActionPlan, meta: IssuePermitMeta): ExecutionPermit {
    const permitId = `prm_${crypto.randomUUID()}`;
    const nonce = crypto.randomBytes(16).toString('hex');
    const issuedAtMs = meta.nowWallMs ?? Date.now();
    const expiresAtMs = issuedAtMs + meta.ttlMs;
    const monoIssued = meta.nowMonotonicNs ?? process.hrtime.bigint();
    const monoExpires = monoIssued + BigInt(meta.ttlMs) * 1_000_000n;

    return this.flowDb.writeTransaction((db) => {
      db.prepare(
        `INSERT INTO action_plans (
          plan_id, job_id, attempt_id, submission_intent_id,
          mode, action_kind, target_control_id, transition_id,
          params_canonical_json, params_digest_sha256,
          project_context_id, account_context_id,
          registry_version, policy_version,
          observed_config_digest, observed_revision, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        plan.planId,
        plan.jobId ?? null,
        plan.attemptId ?? null,
        plan.submissionIntentId ?? null,
        plan.mode,
        plan.actionKind,
        plan.targetControlId,
        plan.transitionId,
        JSON.stringify(plan.paramsCanonical),
        plan.paramsDigestSha256,
        plan.projectContextId,
        plan.accountContextId,
        plan.registryVersion,
        plan.policyVersion,
        plan.observedConfigDigest,
        plan.observedRevision,
        new Date(issuedAtMs).toISOString()
      );

      db.prepare(
        `INSERT INTO execution_permits (
          permit_id, plan_id, nonce,
          controller_epoch, session_epoch, page_id,
          job_id, attempt_id, submission_intent_id,
          action_kind, target_control_id, transition_id,
          params_digest_sha256, project_context_id, account_context_id,
          registry_version, policy_version,
          observed_config_digest, observed_revision,
          status, issued_at_ms, expires_at_ms,
          monotonic_issued_ns, monotonic_expires_ns
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?, ?, ?, ?)`
      ).run(
        permitId,
        plan.planId,
        nonce,
        meta.controllerEpoch,
        meta.sessionEpoch,
        meta.pageId,
        plan.jobId ?? null,
        plan.attemptId ?? null,
        plan.submissionIntentId ?? null,
        plan.actionKind,
        plan.targetControlId,
        plan.transitionId,
        plan.paramsDigestSha256,
        plan.projectContextId,
        plan.accountContextId,
        plan.registryVersion,
        plan.policyVersion,
        plan.observedConfigDigest,
        plan.observedRevision,
        issuedAtMs,
        expiresAtMs,
        monoIssued.toString(),
        monoExpires.toString()
      );

      this.eventRepo.insertWithinTransaction(db, {
        eventType: 'action.planned',
        correlationId: permitId,
        jobId: plan.jobId ?? null,
        controllerEpoch: meta.controllerEpoch,
        policyVersion: plan.policyVersion,
        registryVersion: plan.registryVersion,
        reason: `Permit emitido para ${plan.actionKind} em ${plan.targetControlId}`,
        payload: {
          permitId,
          planId: plan.planId,
          actionKind: plan.actionKind,
          targetControlId: plan.targetControlId,
          transitionId: plan.transitionId,
          paramsDigestSha256: plan.paramsDigestSha256,
        },
      });

      return {
        permitId,
        planId: plan.planId,
        nonce,
        controllerEpoch: meta.controllerEpoch,
        sessionEpoch: meta.sessionEpoch,
        pageId: meta.pageId,
        jobId: plan.jobId ?? null,
        attemptId: plan.attemptId ?? null,
        submissionIntentId: plan.submissionIntentId ?? null,
        actionKind: plan.actionKind,
        targetControlId: plan.targetControlId,
        transitionId: plan.transitionId,
        paramsDigestSha256: plan.paramsDigestSha256,
        projectContextId: plan.projectContextId,
        accountContextId: plan.accountContextId,
        registryVersion: plan.registryVersion,
        policyVersion: plan.policyVersion,
        observedConfigDigest: plan.observedConfigDigest,
        observedRevision: plan.observedRevision,
        status: 'ISSUED',
        issuedAtMs,
        expiresAtMs,
        monotonicIssuedNs: monoIssued,
        monotonicExpiresNs: monoExpires,
      };
    });
  }

  public getPermitAndPlan(permitId: string): { permit: ExecutionPermit; plan: ActionPlan } {
    return this.flowDb.read((db) => {
      const row = db
        .prepare(
          `SELECT
            p.permit_id, p.plan_id, p.nonce,
            p.controller_epoch, p.session_epoch, p.page_id,
            p.job_id, p.attempt_id, p.submission_intent_id,
            p.action_kind, p.target_control_id, p.transition_id,
            p.params_digest_sha256, p.project_context_id, p.account_context_id,
            p.registry_version, p.policy_version,
            p.observed_config_digest, p.observed_revision,
            p.status, p.issued_at_ms, p.expires_at_ms,
            p.monotonic_issued_ns, p.monotonic_expires_ns,
            ap.mode, ap.params_canonical_json
          FROM execution_permits p
          JOIN action_plans ap ON ap.plan_id = p.plan_id
          WHERE p.permit_id = ?`
        )
        .get(permitId) as Record<string, unknown> | undefined;

      if (!row) {
        throw new PermitInvalidError(`Permit '${permitId}' nao encontrado.`);
      }

      const permit: ExecutionPermit = {
        permitId: String(row.permit_id),
        planId: String(row.plan_id),
        nonce: String(row.nonce),
        controllerEpoch: Number(row.controller_epoch),
        sessionEpoch: Number(row.session_epoch),
        pageId: String(row.page_id),
        jobId: row.job_id ? String(row.job_id) : null,
        attemptId: row.attempt_id ? String(row.attempt_id) : null,
        submissionIntentId: row.submission_intent_id ? String(row.submission_intent_id) : null,
        actionKind: row.action_kind as ExecutionPermit['actionKind'],
        targetControlId: String(row.target_control_id),
        transitionId: String(row.transition_id),
        paramsDigestSha256: String(row.params_digest_sha256),
        projectContextId: String(row.project_context_id),
        accountContextId: String(row.account_context_id),
        registryVersion: String(row.registry_version),
        policyVersion: String(row.policy_version),
        observedConfigDigest: String(row.observed_config_digest),
        observedRevision: Number(row.observed_revision),
        status: row.status as PermitStatus,
        issuedAtMs: Number(row.issued_at_ms),
        expiresAtMs: Number(row.expires_at_ms),
        monotonicIssuedNs: BigInt(String(row.monotonic_issued_ns)),
        monotonicExpiresNs: BigInt(String(row.monotonic_expires_ns)),
      };

      const plan: ActionPlan = {
        planId: permit.planId,
        jobId: permit.jobId,
        attemptId: permit.attemptId,
        submissionIntentId: permit.submissionIntentId,
        mode: row.mode as ActionPlan['mode'],
        actionKind: permit.actionKind,
        targetControlId: permit.targetControlId,
        transitionId: permit.transitionId,
        paramsCanonical: JSON.parse(String(row.params_canonical_json)) as Record<string, unknown>,
        paramsDigestSha256: permit.paramsDigestSha256,
        projectContextId: permit.projectContextId,
        accountContextId: permit.accountContextId,
        registryVersion: permit.registryVersion,
        policyVersion: permit.policyVersion,
        observedConfigDigest: permit.observedConfigDigest,
        observedRevision: permit.observedRevision,
      };

      return { permit, plan };
    });
  }

  /**
   * Consome a permissao atomicamente (ISSUED -> CLAIMED).
   * Verifica TTL de parede + TTL monotonico + todos os invariantes de contexto (Arquitetura §10).
   */
  public claimPermitAtomically(
    permitId: string,
    runtimeCtx: ClaimPermitRuntimeContext
  ): { permit: ExecutionPermit; plan: ActionPlan } {
    const nowWallMs = runtimeCtx.nowWallMs ?? Date.now();
    const nowMonoNs = runtimeCtx.nowMonotonicNs ?? process.hrtime.bigint();

    const outcome = this.flowDb.writeTransaction((db) => {
      const { permit, plan } = this.getPermitAndPlan(permitId);

      if (permit.status !== 'ISSUED') {
        return {
          ok: false as const,
          error: new PermitInvalidError(
            `Permit '${permitId}' nao pode ser consumido (status atual: ${permit.status}).`
          ),
        };
      }

      // 1. Verificar expiracao por relogio de parede OU relogio monotonico
      if (nowWallMs > permit.expiresAtMs || nowMonoNs > permit.monotonicExpiresNs) {
        db.prepare(
          `UPDATE execution_permits
           SET status = 'EXPIRED', revocation_reason = 'TTL expirado (wall ou monotonic)'
           WHERE permit_id = ? AND status = 'ISSUED'`
        ).run(permitId);
        return {
          ok: false as const,
          error: new PermitInvalidError(`Permit '${permitId}' expirado por TTL.`),
        };
      }

      // 2. Verificar invariantes de epoch, sessao, pagina, conta, projeto, mapa, politica e configDigest
      const mismatches: string[] = [];
      if (permit.controllerEpoch !== runtimeCtx.controllerEpoch) {
        mismatches.push(`controllerEpoch (${permit.controllerEpoch} != ${runtimeCtx.controllerEpoch})`);
      }
      if (permit.sessionEpoch !== runtimeCtx.sessionEpoch) {
        mismatches.push(`sessionEpoch (${permit.sessionEpoch} != ${runtimeCtx.sessionEpoch})`);
      }
      if (permit.pageId !== runtimeCtx.pageId) {
        mismatches.push(`pageId (${permit.pageId} != ${runtimeCtx.pageId})`);
      }
      if (permit.projectContextId !== runtimeCtx.projectContextId) {
        mismatches.push(`projectContextId (${permit.projectContextId} != ${runtimeCtx.projectContextId})`);
      }
      if (permit.accountContextId !== runtimeCtx.accountContextId) {
        mismatches.push(`accountContextId (${permit.accountContextId} != ${runtimeCtx.accountContextId})`);
      }
      if (permit.registryVersion !== runtimeCtx.registryVersion) {
        mismatches.push(`registryVersion (${permit.registryVersion} != ${runtimeCtx.registryVersion})`);
      }
      if (permit.policyVersion !== runtimeCtx.policyVersion) {
        mismatches.push(`policyVersion (${permit.policyVersion} != ${runtimeCtx.policyVersion})`);
      }
      if (permit.observedConfigDigest !== runtimeCtx.observedConfigDigest) {
        mismatches.push('observedConfigDigest divergente');
      }
      if (permit.observedRevision !== runtimeCtx.observedRevision) {
        mismatches.push(`observedRevision (${permit.observedRevision} != ${runtimeCtx.observedRevision})`);
      }

      if (mismatches.length > 0) {
        const reason = `Contexto divergiu antes da mutacao: ${mismatches.join(', ')}`;
        db.prepare(
          `UPDATE execution_permits
           SET status = 'REVOKED', revocation_reason = ?
           WHERE permit_id = ? AND status = 'ISSUED'`
        ).run(reason, permitId);

        this.eventRepo.insertWithinTransaction(db, {
          eventType: 'action.denied',
          correlationId: permitId,
          jobId: permit.jobId,
          controllerEpoch: runtimeCtx.controllerEpoch,
          policyVersion: runtimeCtx.policyVersion,
          registryVersion: runtimeCtx.registryVersion,
          reason,
          payload: { permitId, mismatches },
        });

        return {
          ok: false as const,
          error: new PermitInvalidError(reason, { mismatches }),
        };
      }

      // 3. Atualizacao atomica condicional
      const updateResult = db
        .prepare(
          `UPDATE execution_permits
           SET status = 'CLAIMED', claimed_at_ms = ?
           WHERE permit_id = ? AND status = 'ISSUED'`
        )
        .run(nowWallMs, permitId);

      if (updateResult.changes !== 1) {
        return {
          ok: false as const,
          error: new PermitInvalidError(`Permit '${permitId}' ja foi consumido concorrentemente.`),
        };
      }

      this.eventRepo.insertWithinTransaction(db, {
        eventType: 'permit.claimed',
        correlationId: permitId,
        jobId: permit.jobId,
        controllerEpoch: runtimeCtx.controllerEpoch,
        policyVersion: runtimeCtx.policyVersion,
        registryVersion: runtimeCtx.registryVersion,
        reason: `Permit '${permitId}' consumido atomicamente (CLAIMED)`,
        payload: {
          permitId,
          actionKind: permit.actionKind,
          targetControlId: permit.targetControlId,
        },
      });

      return {
        ok: true as const,
        permit: { ...permit, status: 'CLAIMED' as const },
        plan,
      };
    });

    if (!outcome.ok) {
      throw outcome.error;
    }
    return { permit: outcome.permit, plan: outcome.plan };
  }

  public markPermitFinished(permitId: string, outcome: ActionOutcome): void {
    this.flowDb.writeTransaction((db) => {
      const { permit } = this.getPermitAndPlan(permitId);
      db.prepare(
        `UPDATE execution_permits
         SET status = 'FINISHED', finished_at_ms = ?, outcome_json = ?
         WHERE permit_id = ? AND status = 'CLAIMED'`
      ).run(Date.now(), JSON.stringify(outcome), permitId);

      this.eventRepo.insertWithinTransaction(db, {
        eventType: 'action.observed',
        correlationId: permitId,
        jobId: permit.jobId,
        controllerEpoch: permit.controllerEpoch,
        policyVersion: permit.policyVersion,
        registryVersion: permit.registryVersion,
        reason: `Outcome registrado: ${outcome.status}`,
        payload: {
          permitId,
          status: outcome.status,
          postconditionVerified: outcome.postconditionVerified,
        },
      });
    });
  }

  /**
   * No restart ou troca de sessao/owner, revoga todas as permissoes ISSUED
   * e retorna quaisquer permissoes que ficaram presas em CLAIMED para reconciliacao (Arquitetura §10).
   */
  public revokeAllInFlightPermitsOnStartup(newControllerEpoch: number, reason: string): {
    revokedIssuedCount: number;
    interruptedClaimedPermits: ExecutionPermit[];
  } {
    return this.flowDb.writeTransaction((db) => {
      const claimedRows = db
        .prepare("SELECT permit_id FROM execution_permits WHERE status = 'CLAIMED'")
        .all() as Array<{ permit_id: string }>;

      const interruptedClaimedPermits = claimedRows.map(
        (r) => this.getPermitAndPlan(r.permit_id).permit
      );

      const res = db
        .prepare(
          `UPDATE execution_permits
           SET status = 'REVOKED', revocation_reason = ?
           WHERE status IN ('ISSUED', 'CLAIMED')`
        )
        .run(reason);

      for (const cp of interruptedClaimedPermits) {
        if (cp.actionKind === 'SUBMIT') {
          this.eventRepo.insertWithinTransaction(db, {
            eventType: 'submission.unknown',
            correlationId: cp.permitId,
            jobId: cp.jobId,
            controllerEpoch: newControllerEpoch,
            policyVersion: cp.policyVersion,
            registryVersion: cp.registryVersion,
            reason: 'Processo reiniciou com permit SUBMIT em estado CLAIMED -> incerteza (UNKNOWN)',
            payload: { permitId: cp.permitId, submissionIntentId: cp.submissionIntentId },
          });
        }
      }

      return {
        revokedIssuedCount: Number(res.changes),
        interruptedClaimedPermits,
      };
    });
  }
}
