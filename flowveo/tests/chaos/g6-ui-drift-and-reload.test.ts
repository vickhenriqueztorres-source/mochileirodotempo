import { describe, expect, it } from 'vitest';
import type { ContextSnapshot } from '../../src/flow/contracts.js';
import { Redactor } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { DriftDetector } from '../../src/mapping/drift-detector.js';
import { PassiveDiscovery } from '../../src/mapping/passive-discovery.js';

const baseCtx: ContextSnapshot = {
  controllerEpoch: 1,
  sessionEpoch: 1,
  pageId: 'page_1',
  url: 'https://labs.google/fx/flow/proj_1',
  locale: 'pt-BR',
  viewport: { width: 1440, height: 900 },
  accountContextId: 'acct_1',
  projectContextId: 'proj_1',
  creationMode: 'text-to-video',
  observedVariant: 'v1',
  observedRevision: 1,
  isAuthenticated: true,
  hasCaptchaOrVerification: false,
  humanInterferenceDetected: false,
};

describe('Gate G6 — Chaos: Locale/Viewport/Variant Drift After Page Reload (§8.4, A-14)', () => {
  it('invalida o mapa inteiro quando locale, viewport ou variante mudam apos recarga', () => {
    const flowDb = new FlowDatabase(':memory:');
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);
    const discovery = new PassiveDiscovery(flowDb, eventRepo, redactor);
    const driftDetector = new DriftDetector(flowDb, eventRepo);

    try {
      const obs = discovery.observeAndRegisterCandidates({
        context: baseCtx,
        pageState: 'COMPOSER_READY',
        rawControls: [
          {
            controlId: 'ctrl_1',
            containerId: 'c1',
            role: 'button',
            name: 'Model',
            visible: true,
            enabled: true,
            matchesCount: 1,
          },
        ],
        policyVersion: '1.0.0',
      });

      // Simular que apos recarga o idioma da interface mudou de pt-BR para en-US e o viewport mudou
      const driftedCtx: ContextSnapshot = {
        ...baseCtx,
        locale: 'en-US',
        viewport: { width: 1280, height: 720 },
      };

      const res = driftDetector.evaluateAndInvalidateOnDrift({
        registryVersion: obs.registryVersion,
        currentContext: driftedCtx,
        liveControls: [
          {
            controlId: 'ctrl_1',
            containerId: 'c1',
            role: 'button',
            name: 'Model',
            visible: true,
            enabled: true,
            matchesCount: 1,
          },
        ],
        policyVersion: '1.0.0',
      });

      expect(res.driftDetected).toBe(true);
      expect(res.scopeMismatchReasons).toHaveLength(2);
      expect(res.invalidatedControlIds).toEqual(['ctrl_1']);
    } finally {
      flowDb.close();
    }
  });
});
