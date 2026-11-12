import { describe, expect, it } from 'vitest';
import type { ContextSnapshot } from '../../src/flow/contracts.js';
import { DefaultAuthorizedExecutor } from '../../src/infrastructure/browser/authorized-executor.js';
import { FlowDriver } from '../../src/infrastructure/browser/flow-driver.js';
import { NavigationGuard } from '../../src/infrastructure/browser/navigation-guard.js';
import { Redactor } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { DriftDetector } from '../../src/mapping/drift-detector.js';
import { PassiveDiscovery } from '../../src/mapping/passive-discovery.js';
import { RegistryValidator } from '../../src/mapping/registry-validator.js';
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

describe('Gate G6 — Unit: RegistryValidator Promotion & Cascade Drift Invalidation (A-13, A-14)', () => {
  it('promove registryVersion para VALIDATED quando validado e invalida transicoes em cascata no drift', async () => {
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
            controlId: 'ctrl_model',
            containerId: 'composer',
            role: 'button',
            name: 'Model',
            label: 'Select Model',
            visible: true,
            enabled: true,
            matchesCount: 1,
          },
        ],
        results: [],
        isResultsVirtualizedOrPartial: false,
      },
    });

    let activeReg = 'reg_0';
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
      registryVersionProvider: () => activeReg,
      policyVersionProvider: () => '1.0.0',
    });
    const bootstrap = new SupervisedBootstrap({
      flowDb,
      eventRepo,
      safetyGateway: gateway,
      executor,
    });
    const driftDetector = new DriftDetector(flowDb, eventRepo);
    const registryValidator = new RegistryValidator(flowDb, driftDetector, redactor);

    try {
      const { context } = await driver.readLiveContextAndConfig();
      const discovery = new PassiveDiscovery(flowDb, eventRepo, redactor);
      const obs = discovery.observeAndRegisterCandidates({
        context,
        pageState: 'COMPOSER_READY',
        rawControls: driver.inspectControlsPassively(),
        policyVersion: '1.0.0',
      });
      activeReg = obs.registryVersion;

      await bootstrap.approveAndExecuteBootstrapTransition(
        {
          registryVersion: activeReg,
          scopeId: obs.scopeId,
          transitionId: 'tr_open_model',
          sourceState: 'COMPOSER_READY',
          controlId: 'ctrl_model',
          actionKind: 'OPEN_UI',
          declaredPurpose: 'Abrir menu modelo',
          paramsCanonical: {},
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

      // 1. Validar sem drift -> status = VALIDATED
      const liveAfter = await driver.readLiveContextAndConfig();
      const valSummary = registryValidator.validateRegistryContext({
        registryVersion: activeReg,
        currentContext: liveAfter.context,
        liveControls: driver.inspectControlsPassively(),
        policyVersion: '1.0.0',
      });
      expect(valSummary.status).toBe('VALIDATED');
      expect(valSummary.counts.validatedControls).toBe(1);
      expect(valSummary.counts.validatedTransitions).toBe(1);

      // 2. Agora simular drift no botao (mudou name de 'Model' para 'Choose Model Engine', embora label continue igual)
      driver.updateSimulatedPageState({
        controls: [
          {
            controlId: 'ctrl_model',
            containerId: 'composer',
            role: 'button',
            name: 'Choose Model Engine',
            label: 'Select Model',
            visible: true,
            enabled: true,
            matchesCount: 1,
          },
        ],
      });

      const valDrifted = registryValidator.validateRegistryContext({
        registryVersion: activeReg,
        currentContext: liveAfter.context as ContextSnapshot,
        liveControls: driver.inspectControlsPassively(),
        policyVersion: '1.0.0',
      });
      expect(valDrifted.status).toBe('INVALIDATED');
      expect(valDrifted.driftResult?.invalidatedControlIds).toEqual(['ctrl_model']);
      expect(valDrifted.driftResult?.invalidatedTransitionIds).toEqual(['tr_open_model']);
      // Seletor alternativo (label) vira candidato para revisao, sem substituir silenciosamente!
      expect(valDrifted.driftResult?.candidateSelectorFallbacksRequiringReview).toEqual([
        'ctrl_model',
      ]);
    } finally {
      flowDb.close();
    }
  });
});
