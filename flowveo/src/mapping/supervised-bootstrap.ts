import crypto from 'node:crypto';
import type { ActionKind, ActionPlan } from '../domain/actions/action-types.js';
import type { AuthorizedExecutor, ContextSnapshot, SafetyGateway } from '../flow/contracts.js';
import { sha256Hex } from '../infrastructure/observability/redactor.js';
import { FlowDatabase } from '../infrastructure/persistence/database.js';
import { EventRepository } from '../infrastructure/persistence/repositories/event-repository.js';
import type { OperationMode } from '../shared/config-schema.js';
import type { PredicateSpec, TransitionDefinition } from './passive-discovery.js';

export interface BootstrapProposal {
  registryVersion: string;
  scopeId: string;
  transitionId: string;
  sourceState: string;
  controlId: string;
  actionKind: ActionKind;
  declaredPurpose: string;
  paramsCanonical: Record<string, unknown>;
  preconditions: PredicateSpec[];
  expectedPostconditions: PredicateSpec[];
  timeoutMs: number;
  approvedForModes: OperationMode[];
  risk: 'low' | 'medium' | 'cost-bearing';
  operatorId: string;
  observedConfigDigest: string;
  policyVersion: string;
}

export interface BootstrapResult {
  approved: boolean;
  transitionStatus: 'validated' | 'invalidated';
  approvalId: string;
  reason: string;
}

/**
 * SupervisedBootstrap (Arquitetura §8.2 / J03 / A-09, A-11):
 * - O operador aprova uma acao concreta num contexto conhecido.
 * - A aprovacao vale apenas para essa transitionId nesse scopeId (nao se estende a botoes semelhantes).
 * - Se a pos-condicao falhar, o clique NAO valida a transicao (A-11).
 */
export class SupervisedBootstrap {
  private readonly flowDb: FlowDatabase;
  private readonly eventRepo: EventRepository;
  private readonly safetyGateway: SafetyGateway;
  private readonly executor: AuthorizedExecutor;

  constructor(params: {
    flowDb: FlowDatabase;
    eventRepo: EventRepository;
    safetyGateway: SafetyGateway;
    executor: AuthorizedExecutor;
  }) {
    this.flowDb = params.flowDb;
    this.eventRepo = params.eventRepo;
    this.safetyGateway = params.safetyGateway;
    this.executor = params.executor;
  }

  public hasApprovalForTransition(scopeId: string, transitionId: string): boolean {
    return this.flowDb.read((db) => {
      const row = db
        .prepare(
          `SELECT approval_id FROM operator_approvals
           WHERE scope_id = ? AND transition_id = ? AND revoked_at IS NULL LIMIT 1`
        )
        .get(scopeId, transitionId);
      return Boolean(row);
    });
  }

  public async approveAndExecuteBootstrapTransition(
    proposal: BootstrapProposal,
    contextSnapshot: ContextSnapshot
  ): Promise<BootstrapResult> {
    if (proposal.actionKind === 'SUBMIT') {
      throw new Error(
        'Proibido aprovar ou executar transicao SUBMIT durante bootstrap de exploracao (A-18).'
      );
    }

    const approvalId = `apr_${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    const beforeStateDigest = sha256Hex(JSON.stringify(contextSnapshot));

    // 1. Registrar a transicao candidata e a aprovacao concreta do operador para ESTA transitionId
    this.flowDb.writeTransaction((db) => {
      db.prepare(
        `INSERT OR REPLACE INTO transitions (
          transition_id, registry_version, scope_id, source_state,
          action_kind, control_id, preconditions_json, expected_postconditions_json,
          timeout_ms, approved_for_modes_json, risk, evidence_ids_json, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'candidate', ?)`
      ).run(
        proposal.transitionId,
        proposal.registryVersion,
        proposal.scopeId,
        proposal.sourceState,
        proposal.actionKind,
        proposal.controlId,
        JSON.stringify(proposal.preconditions),
        JSON.stringify(proposal.expectedPostconditions),
        proposal.timeoutMs,
        JSON.stringify(proposal.approvedForModes),
        proposal.risk,
        nowIso
      );

      db.prepare(
        `INSERT INTO operator_approvals (
          approval_id, scope_id, transition_id, operator_id,
          declared_purpose, before_state_digest, after_state_digest, approved_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)`
      ).run(
        approvalId,
        proposal.scopeId,
        proposal.transitionId,
        proposal.operatorId,
        proposal.declaredPurpose,
        beforeStateDigest,
        nowIso
      );
    });

    // 2. Planejar e solicitar autorizacao ao SafetyGateway no modo 'bootstrap'
    const plan: ActionPlan = {
      planId: `plan_boot_${crypto.randomUUID()}`,
      mode: 'bootstrap',
      actionKind: proposal.actionKind,
      targetControlId: proposal.controlId,
      transitionId: proposal.transitionId,
      paramsCanonical: proposal.paramsCanonical,
      paramsDigestSha256: sha256Hex(JSON.stringify(proposal.paramsCanonical)),
      projectContextId: contextSnapshot.projectContextId,
      accountContextId: contextSnapshot.accountContextId,
      registryVersion: proposal.registryVersion,
      policyVersion: proposal.policyVersion,
      observedConfigDigest: proposal.observedConfigDigest,
      observedRevision: contextSnapshot.observedRevision,
    };

    const decision = await this.safetyGateway.authorize(plan, contextSnapshot);
    if (!decision.allowed) {
      this.markTransitionStatus(
        proposal.registryVersion,
        proposal.transitionId,
        proposal.controlId,
        'invalidated',
        decision.reason
      );
      return {
        approved: false,
        transitionStatus: 'invalidated',
        approvalId,
        reason: decision.reason,
      };
    }

    // 3. Executar a acao via AuthorizedExecutor e verificar pos-condicao (A-11)
    const outcome = await this.executor.execute(decision.permit.permitId);
    if (!outcome.postconditionVerified || outcome.status !== 'SUCCESS') {
      this.markTransitionStatus(
        proposal.registryVersion,
        proposal.transitionId,
        proposal.controlId,
        'invalidated',
        'Pos-condicao nao observada apos a acao (A-11)'
      );
      return {
        approved: true,
        transitionStatus: 'invalidated',
        approvalId,
        reason: 'Clique executado, mas a pos-condicao esperada falhou (A-11).',
      };
    }

    // 4. Pos-condicao verificada: promover APENAS este controle e esta transicao para 'validated'
    this.flowDb.writeTransaction((db) => {
      db.prepare(
        `UPDATE controls
         SET status = 'validated',
             capabilities_json = ?,
             updated_at = ?
         WHERE control_id = ? AND registry_version = ?`
      ).run(
        JSON.stringify([proposal.actionKind]),
        new Date().toISOString(),
        proposal.controlId,
        proposal.registryVersion
      );

      db.prepare(
        `UPDATE transitions
         SET status = 'validated', updated_at = ?
         WHERE transition_id = ? AND registry_version = ?`
      ).run(new Date().toISOString(), proposal.transitionId, proposal.registryVersion);

      db.prepare(
        `UPDATE operator_approvals
         SET after_state_digest = ?
         WHERE approval_id = ?`
      ).run(sha256Hex(JSON.stringify(outcome.details)), approvalId);
    });

    return {
      approved: true,
      transitionStatus: 'validated',
      approvalId,
      reason: `Transicao '${proposal.transitionId}' validada com pos-condicao comprovada.`,
    };
  }

  private markTransitionStatus(
    registryVersion: string,
    transitionId: string,
    controlId: string,
    status: 'invalidated',
    reason: string
  ): void {
    this.flowDb.writeTransaction((db) => {
      db.prepare(
        `UPDATE transitions SET status = ?, updated_at = ? WHERE transition_id = ? AND registry_version = ?`
      ).run(status, new Date().toISOString(), transitionId, registryVersion);
      db.prepare(
        `UPDATE controls SET status = ?, updated_at = ? WHERE control_id = ? AND registry_version = ?`
      ).run(status, new Date().toISOString(), controlId, registryVersion);

      this.eventRepo.insertWithinTransaction(db, {
        eventType: 'action.denied',
        correlationId: transitionId,
        controllerEpoch: 1,
        policyVersion: '1.0.0',
        registryVersion,
        reason,
        payload: { transitionId, controlId, status },
      });
    });
  }

  public getTransitionAndControlStatus(
    registryVersion: string,
    transitionId: string,
    controlId: string
  ): {
    transitionStatus: 'candidate' | 'validated' | 'invalidated';
    controlStatus: 'candidate' | 'validated' | 'invalidated';
    observedMatches: number;
    approvedForModes: OperationMode[];
  } {
    return this.flowDb.read((db) => {
      const ctrl = db
        .prepare(
          `SELECT status, observed_matches FROM controls WHERE control_id = ? AND registry_version = ?`
        )
        .get(controlId, registryVersion) as
        | { status: 'candidate' | 'validated' | 'invalidated'; observed_matches: number }
        | undefined;

      const tr = db
        .prepare(
          `SELECT status, approved_for_modes_json FROM transitions WHERE transition_id = ? AND registry_version = ?`
        )
        .get(transitionId, registryVersion) as
        | { status: 'candidate' | 'validated' | 'invalidated'; approved_for_modes_json: string }
        | undefined;

      return {
        controlStatus: ctrl?.status ?? 'candidate',
        observedMatches: ctrl?.observed_matches ?? 0,
        transitionStatus: tr?.status ?? 'candidate',
        approvedForModes: tr
          ? (JSON.parse(tr.approved_for_modes_json) as OperationMode[])
          : [],
      };
    });
  }
}

export type { TransitionDefinition };
