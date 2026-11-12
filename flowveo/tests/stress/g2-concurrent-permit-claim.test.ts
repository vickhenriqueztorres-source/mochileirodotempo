import { describe, expect, it } from 'vitest';
import type { ActionPlan } from '../../src/domain/actions/action-types.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { PermitStore } from '../../src/safety/permit-store.js';

describe('Gate G2 — Stress: 100 Concurrent Claims on a Single ExecutionPermit (BC-06)', () => {
  it('garante que de 100 tentativas concorrentes de consumir o mesmo permitId, exatamente 1 vence e 99 falham', async () => {
    const flowDb = new FlowDatabase(':memory:');
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);
    const permitStore = new PermitStore(flowDb, eventRepo);

    try {
      const cfgDigest = sha256Hex('cfg_stress');
      const plan: ActionPlan = {
        planId: 'plan_stress_1',
        mode: 'explore',
        actionKind: 'OPEN_UI',
        targetControlId: 'ctrl_menu',
        transitionId: 'tr_menu',
        paramsCanonical: {},
        paramsDigestSha256: sha256Hex('{}'),
        projectContextId: 'proj_1',
        accountContextId: 'acct_1',
        registryVersion: 'reg_1',
        policyVersion: '1.0.0',
        observedConfigDigest: cfgDigest,
        observedRevision: 5,
      };

      const permit = permitStore.issuePermit(plan, {
        controllerEpoch: 1,
        sessionEpoch: 1,
        pageId: 'page_1',
        ttlMs: 15000,
      });

      const attempts = Array.from({ length: 100 }, () =>
        Promise.resolve().then(() =>
          permitStore.claimPermitAtomically(permit.permitId, {
            controllerEpoch: 1,
            sessionEpoch: 1,
            pageId: 'page_1',
            projectContextId: 'proj_1',
            accountContextId: 'acct_1',
            registryVersion: 'reg_1',
            policyVersion: '1.0.0',
            observedConfigDigest: cfgDigest,
            observedRevision: 5,
          })
        )
      );

      const settled = await Promise.allSettled(attempts);
      const fulfilled = settled.filter((s) => s.status === 'fulfilled');
      const rejected = settled.filter((s) => s.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(99);

      const claimedEvents = eventRepo.listEvents({ eventType: 'permit.claimed' });
      expect(claimedEvents).toHaveLength(1);
    } finally {
      flowDb.close();
    }
  });
});
