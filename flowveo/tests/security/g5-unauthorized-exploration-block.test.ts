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

describe('Gate G5 — Security: Approval Does Not Generalize to Similar Controls & Block Unapproved Explore (J03, A-09, A-10)', () => {
  it('aprova transicao A via bootstrap, mas bloqueia transicao B nao aprovada em controle semelhante', async () => {
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
            controlId: 'ctrl_model_btn',
            containerId: 'composer',
            role: 'button',
            name: 'Model',
            visible: true,
            enabled: true,
            matchesCount: 1,
          },
          {
            controlId: 'ctrl_similar_btn',
            containerId: 'composer',
            role: 'button',
            name: 'Model Settings',
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
    let bootstrapRef: SupervisedBootstrap | null = null;

    const gateway = new DefaultSafetyGateway({
      policyEngine,
      permitStore,
      eventRepo,
      lookupTransition: (plan) => {
        if (!bootstrapRef) {
          return {
            controlStatus: 'candidate',
            transitionStatus: 'candidate',
            observedMatches: 1,
            approvedForModes: [],
          };
        }
        const st = bootstrapRef.getTransitionAndControlStatus(
          plan.registryVersion,
          plan.transitionId,
          plan.targetControlId
        );
        const scopeId = new PassiveDiscovery(flowDb, eventRepo, redactor).computeScopeId(
          {
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
          }
        );
        return {
          ...st,
          hasOperatorBootstrapApproval: bootstrapRef.hasApprovalForTransition(
            scopeId,
            plan.transitionId
          ),
        };
      },
      permitTtlMs: 15000,
    });

    const executor = new DefaultAuthorizedExecutor({
      permitStore,
      driverPort: driver,
      registryVersionProvider: () => activeRegistryVersion,
      policyVersionProvider: () => '1.0.0',
    });

    bootstrapRef = new SupervisedBootstrap({
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
      const obsReport = discovery.observeAndRegisterCandidates({
        context,
        pageState: 'COMPOSER_READY',
        rawControls: driver.inspectControlsPassively(),
        policyVersion: '1.0.0',
      });
      activeRegistryVersion = obsReport.registryVersion;

      // 1. Tentar explorar ctrl_model_btn ANTES do bootstrap -> bloqueado!
      const preExplore = await validator.executeAuthorizedExploreStep(
        {
          registryVersion: activeRegistryVersion,
          transitionId: 'tr_open_model',
          controlId: 'ctrl_model_btn',
          actionKind: 'OPEN_UI',
          paramsCanonical: {},
          policyVersion: '1.0.0',
          observedConfigDigest: driver.computeConfigDigest(),
        },
        context
      );
      expect(preExplore.executed).toBe(false);

      // 2. Aprovar tr_open_model via bootstrap supervisionado
      const bootRes = await bootstrapRef.approveAndExecuteBootstrapTransition(
        {
          registryVersion: activeRegistryVersion,
          scopeId: obsReport.scopeId,
          transitionId: 'tr_open_model',
          sourceState: 'COMPOSER_READY',
          controlId: 'ctrl_model_btn',
          actionKind: 'OPEN_UI',
          declaredPurpose: 'Abrir seletor de modelo',
          paramsCanonical: {},
          preconditions: [{ kind: 'control_visible', targetControlId: 'ctrl_model_btn' }],
          expectedPostconditions: [
            { kind: 'menu_open_in_container', containerId: 'composer', targetControlId: 'ctrl_model_btn' },
          ],
          timeoutMs: 5000,
          approvedForModes: ['explore', 'prepare', 'execute'],
          risk: 'low',
          operatorId: 'op_local',
          observedConfigDigest: driver.computeConfigDigest(),
          policyVersion: '1.0.0',
        },
        context
      );
      expect(bootRes.approved).toBe(true);
      expect(bootRes.transitionStatus).toBe('validated');

      // 3. Tentar explorar ctrl_similar_btn (botao parecido, mas NAO aprovado) -> bloqueado (J03)!
      const liveAfterBoot = await driver.readLiveContextAndConfig();
      const unapprovedSimilar = await validator.executeAuthorizedExploreStep(
        {
          registryVersion: activeRegistryVersion,
          transitionId: 'tr_open_similar',
          controlId: 'ctrl_similar_btn',
          actionKind: 'OPEN_UI',
          paramsCanonical: {},
          policyVersion: '1.0.0',
          observedConfigDigest: driver.computeConfigDigest(),
        },
        liveAfterBoot.context
      );
      expect(unapprovedSimilar.executed).toBe(false);

      // 4. Explorar a transicao aprovada tr_open_model -> sucesso!
      const approvedExplore = await validator.executeAuthorizedExploreStep(
        {
          registryVersion: activeRegistryVersion,
          transitionId: 'tr_open_model',
          controlId: 'ctrl_model_btn',
          actionKind: 'OPEN_UI',
          paramsCanonical: {},
          policyVersion: '1.0.0',
          observedConfigDigest: driver.computeConfigDigest(),
        },
        liveAfterBoot.context
      );
      expect(approvedExplore.executed).toBe(true);
      expect(approvedExplore.postconditionVerified).toBe(true);
    } finally {
      flowDb.close();
    }
  });
});
