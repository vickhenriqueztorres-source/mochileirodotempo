import { describe, expect, it } from 'vitest';
import type { ContextSnapshot } from '../../src/flow/contracts.js';
import { Redactor } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { DriftDetector } from '../../src/mapping/drift-detector.js';
import { PassiveDiscovery, type RawControlObservation } from '../../src/mapping/passive-discovery.js';

describe('Gate G6 — Stress: High-Volume Cascade Drift Evaluation Across 100 Controls & Transitions', () => {
  it('avalia drift e invalida em cascata 100 controles e 100 transicoes dependentes com determinismo', () => {
    const flowDb = new FlowDatabase(':memory:');
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);
    const discovery = new PassiveDiscovery(flowDb, eventRepo, redactor);
    const driftDetector = new DriftDetector(flowDb, eventRepo);

    const ctx: ContextSnapshot = {
      controllerEpoch: 1,
      sessionEpoch: 1,
      pageId: 'page_1',
      url: 'https://labs.google/fx/flow/proj_1',
      locale: 'pt-BR',
      viewport: { width: 1920, height: 1080 },
      accountContextId: 'acct_1',
      projectContextId: 'proj_1',
      creationMode: 'text-to-video',
      observedVariant: 'v1',
      observedRevision: 1,
      isAuthenticated: true,
      hasCaptchaOrVerification: false,
      humanInterferenceDetected: false,
    };

    try {
      const rawControls: RawControlObservation[] = Array.from({ length: 100 }, (_, i) => ({
        controlId: `ctrl_${i + 1}`,
        containerId: 'main_panel',
        role: 'button',
        name: `Btn ${i + 1}`,
        visible: true,
        enabled: true,
        matchesCount: 1,
      }));

      const obs = discovery.observeAndRegisterCandidates({
        context: ctx,
        pageState: 'MAIN',
        rawControls,
        policyVersion: '1.0.0',
      });

      // Inserir 100 transicoes vinculadas aos 100 controles
      flowDb.writeTransaction((db) => {
        const stmt = db.prepare(
          `INSERT INTO transitions (
            transition_id, registry_version, scope_id, source_state,
            action_kind, control_id, preconditions_json, expected_postconditions_json,
            timeout_ms, approved_for_modes_json, risk, evidence_ids_json, status, updated_at
          ) VALUES (?, ?, ?, 'MAIN', 'OPEN_UI', ?, '[]', '[]', 5000, '["explore"]', 'low', '[]', 'validated', ?)`
        );
        for (let i = 1; i <= 100; i++) {
          stmt.run(`tr_${i}`, obs.registryVersion, obs.scopeId, `ctrl_${i}`, new Date().toISOString());
        }
      });

      // Simular que metade dos controles (pares) sumiu ou duplicou no DOM
      const mutatedLive = rawControls.map((c, idx) =>
        (idx + 1) % 2 === 0 ? { ...c, matchesCount: 2 } : c
      );

      const drift = driftDetector.evaluateAndInvalidateOnDrift({
        registryVersion: obs.registryVersion,
        currentContext: ctx,
        liveControls: mutatedLive,
        policyVersion: '1.0.0',
      });

      expect(drift.driftDetected).toBe(true);
      expect(drift.invalidatedControlIds).toHaveLength(50);
      expect(drift.invalidatedTransitionIds).toHaveLength(50);
    } finally {
      flowDb.close();
    }
  });
});
