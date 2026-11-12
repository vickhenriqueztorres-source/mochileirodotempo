import { describe, expect, it } from 'vitest';
import { FlowDriver, type SimulatedPageState } from '../../src/infrastructure/browser/flow-driver.js';
import { NavigationGuard } from '../../src/infrastructure/browser/navigation-guard.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
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

function makeInitialPageState(): SimulatedPageState {
  return {
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
        controlId: 'ctrl_menu',
        containerId: 'root',
        role: 'button',
        name: 'Model',
        visible: true,
        enabled: true,
        matchesCount: 1,
      },
    ],
    results: [],
    isResultsVirtualizedOrPartial: false,
  };
}

describe('Gate G3 — Security: CAPTCHA Pause, Popup Block & No Force/Evaluate Bypass (A-20, S-04)', () => {
  it('pausa imediatamente ao detectar CAPTCHA ou popup inesperado e revoga permissoes em voo', async () => {
    const flowDb = new FlowDatabase(':memory:');
    const eventRepo = new EventRepository(flowDb, new Redactor());
    const permitStore = new PermitStore(flowDb, eventRepo);
    const guard = new NavigationGuard(policy);

    const driver = new FlowDriver({
      navigationGuard: guard,
      permitStore,
      eventRepo,
      controllerEpoch: 1,
      sessionEpoch: 1,
      pageId: 'page_1',
      initialState: makeInitialPageState(),
    });

    try {
      // Emitir um permit antes do CAPTCHA aparecer
      const permit = permitStore.issuePermit(
        {
          planId: 'plan_pre_captcha',
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
          observedConfigDigest: driver.computeConfigDigest(),
          observedRevision: 1,
        },
        {
          controllerEpoch: 1,
          sessionEpoch: 1,
          pageId: 'page_1',
          ttlMs: 15000,
        }
      );

      // Simular surgimento de CAPTCHA na tela
      driver.updateSimulatedPageState({ hasCaptchaOrVerification: true });
      await driver.readLiveContextAndConfig();

      expect(driver.isPaused()).toBe(true);
      expect(driver.getPauseReason()).toBe('AUTH');
      expect(driver.getMutationCount()).toBe(0);

      // O permit emitido antes do CAPTCHA foi revogado automaticamente!
      expect(permitStore.getPermitAndPlan(permit.permitId).permit.status).toBe('REVOKED');
    } finally {
      flowDb.close();
    }
  });

  it('proibe force: true, dispatchEvent e evaluateScript no FlowDriver (S-04)', async () => {
    const flowDb = new FlowDatabase(':memory:');
    const eventRepo = new EventRepository(flowDb, new Redactor());
    const permitStore = new PermitStore(flowDb, eventRepo);
    const driver = new FlowDriver({
      navigationGuard: new NavigationGuard(policy),
      permitStore,
      eventRepo,
      controllerEpoch: 1,
      sessionEpoch: 1,
      pageId: 'page_1',
      initialState: makeInitialPageState(),
    });

    try {
      const fakePlan = {
        planId: 'plan_illegal',
        mode: 'explore' as const,
        actionKind: 'OPEN_UI' as const,
        targetControlId: 'ctrl_menu',
        transitionId: 'tr_menu',
        paramsCanonical: { force: true },
        paramsDigestSha256: sha256Hex('{"force":true}'),
        projectContextId: 'proj_1',
        accountContextId: 'acct_1',
        registryVersion: 'reg_1',
        policyVersion: '1.0.0',
        observedConfigDigest: driver.computeConfigDigest(),
        observedRevision: 1,
      };
      const permit = permitStore.issuePermit(fakePlan, {
        controllerEpoch: 1,
        sessionEpoch: 1,
        pageId: 'page_1',
        ttlMs: 15000,
      });

      await expect(driver.performAuthorizedMutation(fakePlan, permit)).rejects.toThrow(
        /Proibido usar force: true/
      );
      expect(driver.getMutationCount()).toBe(0);
    } finally {
      flowDb.close();
    }
  });
});
