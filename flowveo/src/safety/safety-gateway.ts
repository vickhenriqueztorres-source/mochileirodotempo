import type { ActionPlan, AuthorizationDecision } from '../domain/actions/action-types.js';
import type { ContextSnapshot, SafetyGateway } from '../flow/contracts.js';
import { EventRepository } from '../infrastructure/persistence/repositories/event-repository.js';
import { PermitStore } from './permit-store.js';
import { PolicyEngine, type TransitionApprovalCheck } from './policy-engine.js';

export type TransitionLookupFn = (
  plan: ActionPlan,
  snapshot: ContextSnapshot
) => TransitionApprovalCheck;

export class DefaultSafetyGateway implements SafetyGateway {
  private readonly policyEngine: PolicyEngine;
  private readonly permitStore: PermitStore;
  private readonly eventRepo: EventRepository;
  private readonly lookupTransition: TransitionApprovalFn;
  private readonly permitTtlMs: number;

  constructor(params: {
    policyEngine: PolicyEngine;
    permitStore: PermitStore;
    eventRepo: EventRepository;
    lookupTransition: TransitionLookupFn;
    permitTtlMs: number;
  }) {
    this.policyEngine = params.policyEngine;
    this.permitStore = params.permitStore;
    this.eventRepo = params.eventRepo;
    this.lookupTransition = params.lookupTransition;
    this.permitTtlMs = params.permitTtlMs;
  }

  public async authorize(
    plan: ActionPlan,
    currentSnapshot: ContextSnapshot
  ): Promise<AuthorizationDecision> {
    const check = this.lookupTransition(plan, currentSnapshot);
    const decision = this.policyEngine.evaluate(plan, currentSnapshot, check);

    if (!decision.allowed) {
      this.eventRepo.recordStandaloneEvent({
        eventType: 'action.denied',
        correlationId: plan.planId,
        jobId: plan.jobId ?? null,
        controllerEpoch: currentSnapshot.controllerEpoch,
        policyVersion: plan.policyVersion,
        registryVersion: plan.registryVersion,
        reason: decision.reason,
        payload: {
          code: decision.code,
          mode: plan.mode,
          actionKind: plan.actionKind,
          targetControlId: plan.targetControlId,
          transitionId: plan.transitionId,
        },
      });
      return {
        allowed: false,
        code: decision.code,
        reason: decision.reason,
      };
    }

    const permit = this.permitStore.issuePermit(plan, {
      controllerEpoch: currentSnapshot.controllerEpoch,
      sessionEpoch: currentSnapshot.sessionEpoch,
      pageId: currentSnapshot.pageId,
      ttlMs: this.permitTtlMs,
    });

    return {
      allowed: true,
      permit,
      reason: decision.reason,
    };
  }
}

type TransitionApprovalFn = TransitionLookupFn;
