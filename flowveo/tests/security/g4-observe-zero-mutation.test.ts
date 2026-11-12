import { describe, expect, it } from 'vitest';
import { DefaultFlowReader } from '../../src/flow/flow-reader.js';
import { FlowDriver } from '../../src/infrastructure/browser/flow-driver.js';
import { NavigationGuard } from '../../src/infrastructure/browser/navigation-guard.js';
import { Redactor } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { PassiveDiscovery } from '../../src/mapping/passive-discovery.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import type { PolicyConfig } from '../../src/shared/config-schema.js';

const policy: PolicyConfig = {
  policyVersion: '1.0.0',
  releasePhase: 'A',
  allowedWorkOrigins: ['https://labs.google'],
  allowedLoginOrigins: ['https://accounts.google.com'],
  authorizedProjects: ['proj_1'],
  authorizedAccounts: ['acct_1'],
  limits: {
    maxSubmissionsPerRun: 1,
    maxSubmissionsPerWindow: 5,
    windowDurationMs: 3600000,
    maxRequestedOutputsPerRun: 1,
    maxActiveJobs: 1,
    minFreeDiskBytes: 524288000,
    maxDownloadBytesPerSession: 1073741824,
    maxSessionDurationMs: 3600000,
    maxActionsPerSession: 200,
    permitTtlMs: 15000,
    maxDownloadRetries: 2,
    maxConsecutiveFailures: 3,
  },
};

describe('Gate G4 — Security: Observe Mode Performs Zero Work Mutations (A-06)', () => {
  it('inspeciona contexto, formulario, resultados e candidatos com 0 mutacoes no FlowDriver', async () => {
    const flowDb = new FlowDatabase(':memory:');
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);
    const permitStore = new PermitStore(flowDb, eventRepo);

    const driver = new FlowDriver({
      navigationGuard: new NavigationGuard(policy),
      permitStore,
      eventRepo,
      controllerEpoch: 1,
      sessionEpoch: 1,
      pageId: 'page_1',
      initialState: {
        url: 'https://labs.google/fx/flow/proj_1',
        locale: 'pt-BR',
        viewport: { width: 1440, height: 900 },
        accountContextId: 'acct_1',
        projectContextId: 'proj_1',
        creationMode: 'text-to-video',
        observedVariant: 'v1',
        isAuthenticated: true,
        hasCaptchaOrVerification: false,
        humanInterferenceDetected: false,
        selectedModel: 'veo-2',
        selectedAspectRatio: '16:9',
        selectedOutputsCount: 1,
        promptText: '',
        uploadReadyFilename: null,
        observedRevision: 1,
        controls: [
          {
            controlId: 'ctrl_prompt',
            containerId: 'composer',
            role: 'textbox',
            name: 'Prompt',
            visible: true,
            enabled: true,
            matchesCount: 1,
          },
        ],
        results: [],
        isResultsVirtualizedOrPartial: false,
      },
    });

    try {
      const reader = new DefaultFlowReader(driver, { maxReadRetries: 2 });
      const discovery = new PassiveDiscovery(flowDb, eventRepo, redactor);

      const ctx = await reader.inspectContext();
      const form = await reader.inspectCreationForm();
      const res = await reader.inspectResults();
      const rawControls = driver.inspectControlsPassively();

      const report = discovery.observeAndRegisterCandidates({
        context: ctx,
        pageState: 'COMPOSER_READY',
        rawControls,
        policyVersion: '1.0.0',
      });

      expect(form.selectedModel).toBe('veo-2');
      expect(res.items).toHaveLength(0);
      expect(report.discoveredControls).toHaveLength(1);
      // Garantia matematica A-06: zero mutacoes disparadas no navegador
      expect(driver.getMutationCount()).toBe(0);
    } finally {
      flowDb.close();
    }
  });
});
