import { describe, expect, it } from 'vitest';
import { MappingService } from '../../src/application/mapping-service.js';
import { DefaultFlowReader } from '../../src/flow/flow-reader.js';
import { DefaultAuthorizedExecutor } from '../../src/infrastructure/browser/authorized-executor.js';
import { FlowDriver } from '../../src/infrastructure/browser/flow-driver.js';
import { NavigationGuard } from '../../src/infrastructure/browser/navigation-guard.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { DriftDetector } from '../../src/mapping/drift-detector.js';
import { PassiveDiscovery } from '../../src/mapping/passive-discovery.js';
import { RegistryValidator } from '../../src/mapping/registry-validator.js';
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

describe('Gate G6 — Security: Release A Hard Lock Across All Public Paths (A-18)', () => {
  it('bloqueia SUBMIT por MappingService, Bootstrap e SafetyGateway na Release A com 0 submissoes', async () => {
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
        promptText: 'prompt',
        uploadReadyFilename: null,
        observedRevision: 1,
        controls: [
          {
            controlId: 'ctrl_submit',
            containerId: 'composer',
            role: 'button',
            name: 'Generate',
            visible: true,
            enabled: true,
            matchesCount: 1,
          },
        ],
        results: [],
        isResultsVirtualizedOrPartial: false,
      },
    });

    const gateway = new DefaultSafetyGateway({
      policyEngine,
      permitStore,
      eventRepo,
      lookupTransition: () => ({
        controlStatus: 'validated',
        transitionStatus: 'validated',
        observedMatches: 1,
        hasOperatorBootstrapApproval: true,
        approvedForModes: ['bootstrap', 'explore', 'execute'],
      }),
      permitTtlMs: 15000,
    });

    const executor = new DefaultAuthorizedExecutor({
      permitStore,
      driverPort: driver,
      registryVersionProvider: () => 'reg_1',
      policyVersionProvider: () => '1.0.0',
    });

    const reader = new DefaultFlowReader(driver, { maxReadRetries: 2 });
    const discovery = new PassiveDiscovery(flowDb, eventRepo, redactor);
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
    const driftDetector = new DriftDetector(flowDb, eventRepo);
    const regValidator = new RegistryValidator(flowDb, driftDetector, redactor);

    const mappingService = new MappingService({
      flowReader: reader,
      passiveDiscovery: discovery,
      supervisedBootstrap: bootstrap,
      transitionValidator: validator,
      registryValidator: regValidator,
      inspectControlsFn: () => driver.inspectControlsPassively(),
    });

    try {
      const obs = await mappingService.observe('READY', '1.0.0');

      // 1. Tentar aprovar SUBMIT no bootstrap -> rejeitado imediatamente
      await expect(
        mappingService.bootstrap({
          registryVersion: obs.registryVersion,
          scopeId: obs.scopeId,
          transitionId: 'tr_submit',
          sourceState: 'READY',
          controlId: 'ctrl_submit',
          actionKind: 'SUBMIT',
          declaredPurpose: 'Tentar burlar Release A',
          paramsCanonical: {},
          preconditions: [],
          expectedPostconditions: [],
          timeoutMs: 5000,
          approvedForModes: ['execute'],
          risk: 'cost-bearing',
          operatorId: 'op_1',
          observedConfigDigest: driver.computeConfigDigest(),
          policyVersion: '1.0.0',
        })
      ).rejects.toThrow(/Proibido aprovar ou executar transicao SUBMIT/);

      // 2. Tentar autorizar SUBMIT diretamente no SafetyGateway -> negado (RELEASE_A_SUBMIT_BLOCKED)
      const ctx = await reader.inspectContext();
      const directAuth = await gateway.authorize(
        {
          planId: 'plan_direct_submit',
          mode: 'execute',
          actionKind: 'SUBMIT',
          targetControlId: 'ctrl_submit',
          transitionId: 'tr_submit',
          paramsCanonical: {},
          paramsDigestSha256: sha256Hex('{}'),
          projectContextId: 'proj_1',
          accountContextId: 'acct_1',
          registryVersion: obs.registryVersion,
          policyVersion: '1.0.0',
          observedConfigDigest: driver.computeConfigDigest(),
          observedRevision: 1,
        },
        ctx
      );
      expect(directAuth.allowed).toBe(false);
      expect(driver.getMutationCount()).toBe(0);
    } finally {
      flowDb.close();
    }
  });
});
