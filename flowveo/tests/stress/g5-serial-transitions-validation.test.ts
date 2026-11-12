import { describe, expect, it } from 'vitest';
import { DefaultAuthorizedExecutor } from '../../src/infrastructure/browser/authorized-executor.js';
import { FlowDriver } from '../../src/infrastructure/browser/flow-driver.js';
import { NavigationGuard } from '../../src/infrastructure/browser/navigation-guard.js';
import { Redactor } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { PassiveDiscovery } from '../../src/mapping/passive-discovery.js';
import { SupervisedBootstrap } from '../../src/mapping/supervised-bootstrap.js';
import { TransitionValidator } from '../../src/mapping/transition-validator.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import { PolicyEngine } from '../../src/safety/policy-engine.js';
import { DefaultSafetyGateway } from '../../src/safety/safety-gateway.js';
import type { AppConfig, PolicyConfig } from '../../src/shared/config-schema.js';

const appConfig: AppConfig = {
  mode: 'explore',
  releasePhase: 'A',
  executionEnabled: false,
  maxConcurrentJobs: 1,
  maxSubmissionsPerRun: 1,
  maxRequestedOutputsPerRun: 1,
  maxReadRetries: 2,
  stopOnUnknownState: true,
  allowAutomaticResubmission: false,
  allowAccountChanges: false,
  allowPurchases: false,
  allowDeletion: false,
  allowRawTraces: false,
  dryRunMutatesPage: false,
  runtimeDir: './runtime',
};

const policyConfig: PolicyConfig = {
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

describe('Gate G5 — Stress: 50 Sequential Validated Transitions With Postcondition Re-Read', () => {
  it('executa 50 passos sequenciais de exploracao validada com verificacao de pos-condicao', async () => {
    const flowDb = new FlowDatabase(':memory:');
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);
    const permitStore = new PermitStore(flowDb, eventRepo);
    const policyEngine = new PolicyEngine(appConfig, policyConfig);

    const driver = new FlowDriver({
      navigationGuard: new NavigationGuard(policyConfig),
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
            controlId: 'ctrl_cfg',
            containerId: 'composer',
            role: 'combobox',
            name: 'Model',
            visible: true,
            enabled: true,
            matchesCount: 1,
          },
        ],
        results: [],
        isResultsVirtualizedOrPartial: false,
      },
    });

    let activeRegistryVersion = 'reg_0';
    const gateway = new DefaultSafetyGateway({
      policyEngine,
      permitStore,
      eventRepo,
      lookupTransition: () => ({
        controlStatus: 'validated',
        transitionStatus: 'validated',
        observedMatches: 1,
        hasOperatorBootstrapApproval: true,
        approvedForModes: ['bootstrap', 'explore'],
      }),
      permitTtlMs: 15000,
    });

    const executor = new DefaultAuthorizedExecutor({
      permitStore,
      driverPort: driver,
      registryVersionProvider: () => activeRegistryVersion,
      policyVersionProvider: () => '1.0.0',
    });

    const bootstrap = new SupervisedBootstrap({
      flowDb,
      eventRepo,
      safetyGateway: gateway,
      executor,
    });

    const validator = new TransitionValidator({
      flowDb,
      safetyGateway: gateway,
      executor,
    });

    try {
      const { context } = await driver.readLiveContextAndConfig();
      const discovery = new PassiveDiscovery(flowDb, eventRepo, redactor);
      const report = discovery.observeAndRegisterCandidates({
        context,
        pageState: 'COMPOSER_READY',
        rawControls: driver.inspectControlsPassively(),
        policyVersion: '1.0.0',
      });
      activeRegistryVersion = report.registryVersion;

      await bootstrap.approveAndExecuteBootstrapTransition(
        {
          registryVersion: activeRegistryVersion,
          scopeId: report.scopeId,
          transitionId: 'tr_cfg_model',
          sourceState: 'COMPOSER_READY',
          controlId: 'ctrl_cfg',
          actionKind: 'CONFIGURE',
          declaredPurpose: 'Selecionar modelo',
          paramsCanonical: { model: 'veo-2' },
          preconditions: [],
          expectedPostconditions: [],
          timeoutMs: 5000,
          approvedForModes: ['explore'],
          risk: 'low',
          operatorId: 'op_1',
          observedConfigDigest: driver.computeConfigDigest(),
          policyVersion: '1.0.0',
        },
        context
      );

      for (let i = 0; i < 50; i++) {
        const live = await driver.readLiveContextAndConfig();
        const modelName = i % 2 === 0 ? 'veo-2-fast' : 'veo-2-quality';
        const res = await validator.executeAuthorizedExploreStep(
          {
            registryVersion: activeRegistryVersion,
            transitionId: 'tr_cfg_model',
            controlId: 'ctrl_cfg',
            actionKind: 'CONFIGURE',
            paramsCanonical: { model: modelName },
            policyVersion: '1.0.0',
            observedConfigDigest: driver.computeConfigDigest(),
          },
          live.context
        );
        expect(res.executed).toBe(true);
        expect(res.postconditionVerified).toBe(true);
      }

      expect(driver.getMutationCount()).toBe(51); // 1 bootstrap + 50 explore
    } finally {
      flowDb.close();
    }
  });
});
