import crypto from 'node:crypto';
import { ActionPlanSchema, type ActionPlan } from '../domain/actions/action-types.js';
import { sha256Hex } from '../infrastructure/observability/redactor.js';
import type { ActionInput, ActionPlanner, ContextSnapshot } from './contracts.js';

export interface ObservedConfigDigestInput {
  projectContextId: string;
  model: string;
  aspectRatio: string;
  requestedOutputs: number;
  promptDigestSha256: string;
}

export function computeObservedConfigDigest(input: ObservedConfigDigestInput): string {
  return sha256Hex(
    JSON.stringify({
      projectContextId: input.projectContextId,
      model: input.model,
      aspectRatio: input.aspectRatio,
      requestedOutputs: input.requestedOutputs,
      promptDigestSha256: input.promptDigestSha256,
    })
  );
}

/**
 * DefaultActionPlanner (Arquitetura §9 / BC-02):
 * Gera planos de acao deterministicos e serializaveis, vinculados ao contexto,
 * revisao observada e digest canonico dos parametros.
 */
export class DefaultActionPlanner implements ActionPlanner {
  public plan(input: ActionInput, snapshot: ContextSnapshot): ActionPlan {
    const canonicalKeys = Object.keys(input.paramsCanonical).sort();
    const sortedParams: Record<string, unknown> = {};
    for (const k of canonicalKeys) {
      sortedParams[k] = input.paramsCanonical[k];
    }
    const paramsDigestSha256 = sha256Hex(JSON.stringify(sortedParams));

    return ActionPlanSchema.parse({
      planId: `plan_${crypto.randomUUID()}`,
      jobId: input.jobId ?? null,
      attemptId: input.attemptId ?? null,
      submissionIntentId: input.submissionIntentId ?? null,
      mode: input.mode,
      actionKind: input.actionKind,
      targetControlId: input.targetControlId,
      transitionId: input.transitionId,
      paramsCanonical: sortedParams,
      paramsDigestSha256,
      projectContextId: snapshot.projectContextId,
      accountContextId: snapshot.accountContextId,
      registryVersion: input.registryVersion,
      policyVersion: input.policyVersion,
      observedConfigDigest: input.observedConfigDigest,
      observedRevision: snapshot.observedRevision,
    });
  }
}
