import crypto from 'node:crypto';
import type { ActionPlan } from '../domain/actions/action-types.js';
import type { AuthorizedExecutor, ContextSnapshot, SafetyGateway } from '../flow/contracts.js';
import { sha256Hex } from '../infrastructure/observability/redactor.js';
import { FlowDatabase } from '../infrastructure/persistence/database.js';

export interface ExploreStepInput {
  registryVersion: string;
  transitionId: string;
  controlId: string;
  actionKind: 'OPEN_UI' | 'CONFIGURE' | 'FILL' | 'UPLOAD';
  paramsCanonical: Record<string, unknown>;
  policyVersion: string;
  observedConfigDigest: string;
}

export interface ExploreStepResult {
  executed: boolean;
  postconditionVerified: boolean;
  reason: string;
}

/**
 * TransitionValidator / Modo Explore (Arquitetura §8.2, §8.4, §17 / A-10, A-11):
 * - Executa apenas transicoes previamente aprovadas e validadas no modo 'explore'.
 * - Se uma acao nao estiver no conjunto aprovado, bloqueia e registra pendencia.
 * - Se a pos-condicao falhar, invalida a transicao e o controle.
 */
export class TransitionValidator {
  private readonly flowDb: FlowDatabase;
  private readonly safetyGateway: SafetyGateway;
  private readonly executor: AuthorizedExecutor;

  constructor(params: {
    flowDb: FlowDatabase;
    safetyGateway: SafetyGateway;
    executor: AuthorizedExecutor;
  }) {
    this.flowDb = params.flowDb;
    this.safetyGateway = params.safetyGateway;
    this.executor = params.executor;
  }

  public async executeAuthorizedExploreStep(
    step: ExploreStepInput,
    contextSnapshot: ContextSnapshot
  ): Promise<ExploreStepResult> {
    const plan: ActionPlan = {
      planId: `plan_exp_${crypto.randomUUID()}`,
      mode: 'explore',
      actionKind: step.actionKind,
      targetControlId: step.controlId,
      transitionId: step.transitionId,
      paramsCanonical: step.paramsCanonical,
      paramsDigestSha256: sha256Hex(JSON.stringify(step.paramsCanonical)),
      projectContextId: contextSnapshot.projectContextId,
      accountContextId: contextSnapshot.accountContextId,
      registryVersion: step.registryVersion,
      policyVersion: step.policyVersion,
      observedConfigDigest: step.observedConfigDigest,
      observedRevision: contextSnapshot.observedRevision,
    };

    const decision = await this.safetyGateway.authorize(plan, contextSnapshot);
    if (!decision.allowed) {
      return {
        executed: false,
        postconditionVerified: false,
        reason: decision.reason,
      };
    }

    const outcome = await this.executor.execute(decision.permit.permitId);
    if (!outcome.postconditionVerified || outcome.status !== 'SUCCESS') {
      // Invalida controle e transicao imediatamente se a pos-condicao falhar (A-11)
      this.flowDb.writeTransaction((db) => {
        db.prepare(
          `UPDATE transitions SET status = 'invalidated', updated_at = ?
           WHERE transition_id = ? AND registry_version = ?`
        ).run(new Date().toISOString(), step.transitionId, step.registryVersion);
        db.prepare(
          `UPDATE controls SET status = 'invalidated', updated_at = ?
           WHERE control_id = ? AND registry_version = ?`
        ).run(new Date().toISOString(), step.controlId, step.registryVersion);
      });

      return {
        executed: true,
        postconditionVerified: false,
        reason: 'Pos-condicao falhou durante exploracao — transicao invalidada (A-11).',
      };
    }

    return {
      executed: true,
      postconditionVerified: true,
      reason: 'Transicao de exploracao executada e pos-condicao verificada.',
    };
  }
}
