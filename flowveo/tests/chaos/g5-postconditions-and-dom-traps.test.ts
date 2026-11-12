import { describe, expect, it } from 'vitest';
import { DefaultAuthorizedExecutor } from '../../src/infrastructure/browser/authorized-executor.js';
import { FlowDriver } from '../../src/infrastructure/browser/flow-driver.js';
import { NavigationGuard } from '../../src/infrastructure/browser/navigation-guard.js';
import { Redactor } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { PassiveDiscovery } from '../../src/mapping/passive-discovery.js';
import { SupervisedBootstrap } from '../../src/mapping/supervised-bootstrap.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import { PolicyEngine } from '../../src/safety/policy-engine.js';
import { DefaultSafetyGateway } from '../../src/safety/safety-gateway.js';
import type { AppConfig, PolicyConfig } from '../../src/shared/config-schema.js';

const appConfig: AppConfig = {
  mode: 'bootstrap',
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

describe('Gate G5 — Chaos: Click Without Postcondition & Delayed Hydration Prompt Wipe (A-11, §17, §23)', () => {
  it('invalida a transicao quando o clique ocorre mas a pos-condicao falha ou a hidratacao apaga o prompt', async () => {
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

    let activeRegistryVersion = 'reg_0';
    const gateway = new DefaultSafetyGateway({
      policyEngine,
      permitStore,
      eventRepo,
      lookupTransition: () => ({
        controlStatus: 'candidate',
        transitionStatus: 'candidate',
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

      // Simular hidratacao atrasada que apaga parte do prompt apos o FILL!
      driver.setPostClickBehaviorForTesting('DELAYED_HYDRATION_WIPE_PROMPT');

      const res = await bootstrap.approveAndExecuteBootstrapTransition(
        {
          registryVersion: activeRegistryVersion,
          scopeId: report.scopeId,
          transitionId: 'tr_fill_prompt',
          sourceState: 'COMPOSER_READY',
          controlId: 'ctrl_prompt',
          actionKind: 'FILL',
          declaredPurpose: 'Preencher prompt de teste',
          paramsCanonical: { promptText: 'Prompt completo que sera truncado pela hidratacao' },
          preconditions: [],
          expectedPostconditions: [],
          timeoutMs: 5000,
          approvedForModes: ['explore', 'prepare'],
          risk: 'low',
          operatorId: 'op_1',
          observedConfigDigest: driver.computeConfigDigest(),
          policyVersion: '1.0.0',
        },
        context
      );

      // A transicao DEVE ser marcada como invalidated porque o texto final relido nao bateu!
      expect(res.transitionStatus).toBe('invalidated');
      const statusInDb = bootstrap.getTransitionAndControlStatus(
        activeRegistryVersion,
        'tr_fill_prompt',
        'ctrl_prompt'
      );
      expect(statusInDb.transitionStatus).toBe('invalidated');
      expect(statusInDb.controlStatus).toBe('invalidated');
    } finally {
      flowDb.close();
    }
  });
});
