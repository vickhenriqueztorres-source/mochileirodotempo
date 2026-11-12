import { describe, expect, it } from 'vitest';
import type { ActionPlan } from '../../src/domain/actions/action-types.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import { PermitInvalidError } from '../../src/shared/errors.js';

function createSamplePlan(actionKind: ActionPlan['actionKind'] = 'OPEN_UI'): ActionPlan {
  return {
    planId: `plan_${Math.random().toString(36).slice(2, 10)}`,
    jobId: 'job_1',
    attemptId: 'att_1',
    submissionIntentId: actionKind === 'SUBMIT' ? 'sub_int_1' : null,
    mode: actionKind === 'SUBMIT' ? 'execute' : 'explore',
    actionKind,
    targetControlId: 'ctrl_1',
    transitionId: 'tr_1',
    paramsCanonical: {},
    paramsDigestSha256: sha256Hex('{}'),
    projectContextId: 'proj_1',
    accountContextId: 'acct_1',
    registryVersion: 'reg_1',
    policyVersion: '1.0.0',
    observedConfigDigest: sha256Hex('cfg_1'),
    observedRevision: 1,
  };
}

describe('Gate G2 — Chaos: Monotonic Clock Skew & Crash After CLAIMED (§10)', () => {
  it('expira permit pelo relogio monotonico mesmo se o relogio do sistema for atrasado manualmente', () => {
    const flowDb = new FlowDatabase(':memory:');
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);
    const permitStore = new PermitStore(flowDb, eventRepo);

    try {
      const plan = createSamplePlan('OPEN_UI');
      const permit = permitStore.issuePermit(plan, {
        controllerEpoch: 1,
        sessionEpoch: 1,
        pageId: 'page_1',
        ttlMs: 5000,
        nowWallMs: 1_000_000,
        nowMonotonicNs: 1_000_000_000n,
      });

      // Simular atraso malicioso/acidental do relogio de parede (nowWallMs ainda dentro do prazo),
      // mas relogio monotonico avancou 6 segundos (6_000_000_000ns)
      expect(() =>
        permitStore.claimPermitAtomically(permit.permitId, {
          controllerEpoch: 1,
          sessionEpoch: 1,
          pageId: 'page_1',
          projectContextId: 'proj_1',
          accountContextId: 'acct_1',
          registryVersion: 'reg_1',
          policyVersion: '1.0.0',
          observedConfigDigest: sha256Hex('cfg_1'),
          observedRevision: 1,
          nowWallMs: 1_001_000, // Aparenta apenas +1s no relogio de parede
          nowMonotonicNs: 7_500_000_000n, // Mas passaram 6.5s no relogio monotonico!
        })
      ).toThrow(PermitInvalidError);

      const after = permitStore.getPermitAndPlan(permit.permitId);
      expect(after.permit.status).toBe('EXPIRED');
    } finally {
      flowDb.close();
    }
  });

  it('revoga permits em voo no restart e registra submission.unknown quando SUBMIT cai em CLAIMED', () => {
    const flowDb = new FlowDatabase(':memory:');
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);
    const permitStore = new PermitStore(flowDb, eventRepo);

    try {
      const planIssued = createSamplePlan('OPEN_UI');
      const permitIssued = permitStore.issuePermit(planIssued, {
        controllerEpoch: 1,
        sessionEpoch: 1,
        pageId: 'page_1',
        ttlMs: 15000,
      });

      const planSubmit = createSamplePlan('SUBMIT');
      const permitSubmit = permitStore.issuePermit(planSubmit, {
        controllerEpoch: 1,
        sessionEpoch: 1,
        pageId: 'page_1',
        ttlMs: 15000,
      });

      // Consumir o permit SUBMIT (simulando que o processo caiu logo apos marcar CLAIMED)
      permitStore.claimPermitAtomically(permitSubmit.permitId, {
        controllerEpoch: 1,
        sessionEpoch: 1,
        pageId: 'page_1',
        projectContextId: 'proj_1',
        accountContextId: 'acct_1',
        registryVersion: 'reg_1',
        policyVersion: '1.0.0',
        observedConfigDigest: sha256Hex('cfg_1'),
        observedRevision: 1,
      });

      // Simular restart no epoch 2
      const recovery = permitStore.revokeAllInFlightPermitsOnStartup(
        2,
        'Reinicio de controlador detectado'
      );

      expect(recovery.revokedIssuedCount).toBe(2);
      expect(recovery.interruptedClaimedPermits).toHaveLength(1);
      expect(recovery.interruptedClaimedPermits[0]?.permitId).toBe(permitSubmit.permitId);

      // Verificar que o evento submission.unknown foi gravado para reconciliacao obrigatoria
      const unknownEvents = eventRepo.listEvents({ eventType: 'submission.unknown' });
      expect(unknownEvents).toHaveLength(1);
      expect(unknownEvents[0]?.correlationId).toBe(permitSubmit.permitId);

      // E nenhuma das duas permissoes pode ser consumida apos o restart
      expect(permitStore.getPermitAndPlan(permitIssued.permitId).permit.status).toBe('REVOKED');
      expect(permitStore.getPermitAndPlan(permitSubmit.permitId).permit.status).toBe('REVOKED');
    } finally {
      flowDb.close();
    }
  });
});
