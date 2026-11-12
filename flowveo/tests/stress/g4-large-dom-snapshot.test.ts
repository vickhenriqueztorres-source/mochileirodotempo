import { describe, expect, it } from 'vitest';
import type { ContextSnapshot } from '../../src/flow/contracts.js';
import { Redactor } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { PassiveDiscovery, type RawControlObservation } from '../../src/mapping/passive-discovery.js';

describe('Gate G4 — Stress: 600 Dense DOM Candidate Controls Discovery & Sanitization', () => {
  it('registra e sanitiza 600 controles candidatos em transacao unica sem perda', () => {
    const flowDb = new FlowDatabase(':memory:');
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);
    const discovery = new PassiveDiscovery(flowDb, eventRepo, redactor);

    const ctx: ContextSnapshot = {
      controllerEpoch: 1,
      sessionEpoch: 1,
      pageId: 'page_1',
      url: 'https://labs.google/fx/flow/proj_stress',
      locale: 'pt-BR',
      viewport: { width: 1920, height: 1080 },
      accountContextId: 'acct_stress',
      projectContextId: 'proj_stress',
      creationMode: 'text-to-video',
      observedVariant: 'v1',
      observedRevision: 1,
      isAuthenticated: true,
      hasCaptchaOrVerification: false,
      humanInterferenceDetected: false,
    };

    try {
      const rawControls: RawControlObservation[] = Array.from({ length: 600 }, (_, i) => ({
        controlId: `ctrl_${i + 1}`,
        containerId: `panel_${(i % 10) + 1}`,
        role: 'button',
        name: `Action Button ${i + 1}`,
        visible: true,
        enabled: true,
        matchesCount: i % 50 === 0 ? 2 : 1, // 12 controles duplicados
      }));

      const report = discovery.observeAndRegisterCandidates({
        context: ctx,
        pageState: 'DENSE_VIEW',
        rawControls,
        policyVersion: '1.0.0',
      });

      expect(report.discoveredControls).toHaveLength(600);
      expect(report.ambiguousControlIds).toHaveLength(12);
    } finally {
      flowDb.close();
    }
  });
});
