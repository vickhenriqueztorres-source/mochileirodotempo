import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DoctorService } from '../../src/application/doctor-service.js';
import { DefaultAuthorizedExecutor } from '../../src/infrastructure/browser/authorized-executor.js';
import { BrowserManager } from '../../src/infrastructure/browser/browser-manager.js';
import { FlowDriver } from '../../src/infrastructure/browser/flow-driver.js';
import { NavigationGuard } from '../../src/infrastructure/browser/navigation-guard.js';
import { Redactor } from '../../src/infrastructure/observability/redactor.js';
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
import { validateAndResolveConfig } from '../../src/shared/config-schema.js';

describe('Homologacao Mayk (Profile 18 — flow.google.com/project/560389d6-0558-4e65-8946-e48a2b12b453)', () => {
  const projectRoot = path.resolve(process.cwd());
  const savedProfileDir = path.join(projectRoot, 'runtime', 'profile');

  it('verifica persistencia do perfil salvo do Mayk (Profile 18 + Cookies + Local State) em runtime/profile', () => {
    const metaPath = path.join(savedProfileDir, 'saved-session-metadata.json');
    expect(fs.existsSync(metaPath)).toBe(true);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    expect(meta.accountEmail).toBe('matosmayk9@gmail.com');
    expect(meta.projectContextId).toBe('560389d6-0558-4e65-8946-e48a2b12b453');

    expect(fs.existsSync(path.join(savedProfileDir, 'Local State'))).toBe(true);
    expect(fs.existsSync(path.join(savedProfileDir, 'Default', 'Network', 'Cookies'))).toBe(true);
    expect(fs.existsSync(path.join(savedProfileDir, 'Profile 18', 'Network', 'Cookies'))).toBe(
      true
    );
  });

  it('executa doctor, observe passivo, bootstrap, explore, map validate e prepare na sessao do Mayk', async () => {
    const defaultsRaw = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'config', 'defaults.json'), 'utf8')
    );
    const policyRaw = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'config', 'policy.json'), 'utf8')
    );
    const envConfig = validateAndResolveConfig(defaultsRaw, policyRaw);

    expect(envConfig.policy.allowedWorkOrigins).toContain('https://flow.google.com');
    expect(envConfig.policy.authorizedProjects).toContain(
      '560389d6-0558-4e65-8946-e48a2b12b453'
    );
    expect(envConfig.policy.authorizedAccounts).toContain('matosmayk9@gmail.com');

    const flowDb = new FlowDatabase(':memory:');
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);
    const permitStore = new PermitStore(flowDb, eventRepo);

    try {
      const doctor = new DoctorService();
      const docReport = doctor.runDiagnostics(envConfig, flowDb);
      expect(docReport.overallReadyForObservation).toBe(true);
      expect(docReport.generationHomologated).toBe(false);

      const bm = new BrowserManager({
        profileDir: savedProfileDir,
        controllerEpoch: 1,
        permitStore,
      });
      const sessionMeta = bm.openDedicatedSession();
      expect(sessionMeta.isOpen).toBe(true);

      const driver = new FlowDriver({
        navigationGuard: new NavigationGuard(envConfig.policy),
        permitStore,
        eventRepo,
        controllerEpoch: 1,
        sessionEpoch: sessionMeta.sessionEpoch,
        pageId: sessionMeta.pageId,
        initialState: {
          url: 'https://flow.google.com/project/560389d6-0558-4e65-8946-e48a2b12b453',
          locale: 'pt-BR',
          viewport: { width: 1920, height: 1080 },
          accountContextId: 'matosmayk9@gmail.com',
          projectContextId: '560389d6-0558-4e65-8946-e48a2b12b453',
          creationMode: 'standard',
          observedVariant: 'flow-web-v2',
          isAuthenticated: true,
          hasCaptchaOrVerification: false,
          humanInterferenceDetected: false,
          selectedModel: 'Nano Banana 2.1',
          selectedAspectRatio: '16:9',
          selectedOutputsCount: 2,
          promptText: '',
          uploadReadyFilename: null,
          observedRevision: 1,
          controls: [
            {
              controlId: 'ctrl_prompt_input',
              containerId: 'composer_root',
              role: 'textbox',
              name: 'O que você quer criar?',
              placeholder: 'O que você quer criar?',
              visible: true,
              enabled: true,
              matchesCount: 1,
              currentValue: '',
            },
            {
              controlId: 'ctrl_model_selector',
              containerId: 'composer_toolbar',
              role: 'button',
              name: 'Nano Banana 2.1 x2',
              label: 'Model Selector',
              visible: true,
              enabled: true,
              matchesCount: 1,
              currentValue: 'Nano Banana 2.1 x2',
            },
            {
              controlId: 'ctrl_agent_toggle',
              containerId: 'composer_toolbar',
              role: 'button',
              name: 'Agente',
              visible: true,
              enabled: true,
              matchesCount: 1,
            },
            {
              controlId: 'ctrl_tab_all_media',
              containerId: 'sidebar_nav',
              role: 'button',
              name: 'Todas as mídias',
              visible: true,
              enabled: true,
              matchesCount: 1,
            },
            {
              controlId: 'ctrl_tab_scenes',
              containerId: 'sidebar_nav',
              role: 'button',
              name: 'Cenas',
              visible: true,
              enabled: true,
              matchesCount: 1,
            },
            {
              controlId: 'ctrl_submit',
              containerId: 'composer_root',
              role: 'button',
              name: 'Gerar',
              visible: true,
              enabled: true,
              matchesCount: 1,
            },
          ],
          results: [],
          isResultsVirtualizedOrPartial: false,
        },
      });

      const { context } = await driver.readLiveContextAndConfig();
      const discovery = new PassiveDiscovery(flowDb, eventRepo, redactor);
      const obs = discovery.observeAndRegisterCandidates({
        context,
        pageState: 'COMPOSER_READY',
        rawControls: driver.inspectControlsPassively(),
        policyVersion: envConfig.policy.policyVersion,
      });

      expect(obs.discoveredControls).toHaveLength(6);
      expect(obs.ambiguousControlIds).toHaveLength(0);
      expect(driver.getMutationCount()).toBe(0);

      let activeReg = obs.registryVersion;
      const gateway = new DefaultSafetyGateway({
        policyEngine: new PolicyEngine(
          { ...envConfig.app, mode: 'bootstrap' },
          envConfig.policy
        ),
        permitStore,
        eventRepo,
        lookupTransition: () => ({
          controlStatus: 'validated',
          transitionStatus: 'validated',
          observedMatches: 1,
          hasOperatorBootstrapApproval: true,
          approvedForModes: ['bootstrap', 'explore'],
        }),
        permitTtlMs: envConfig.policy.limits.permitTtlMs,
      });

      const executor = new DefaultAuthorizedExecutor({
        permitStore,
        driverPort: driver,
        registryVersionProvider: () => activeReg,
        policyVersionProvider: () => envConfig.policy.policyVersion,
      });

      const bootstrap = new SupervisedBootstrap({
        flowDb,
        eventRepo,
        safetyGateway: gateway,
        executor,
      });

      const bootRes = await bootstrap.approveAndExecuteBootstrapTransition(
        {
          registryVersion: activeReg,
          scopeId: obs.scopeId,
          transitionId: 'tr_open_model_selector',
          sourceState: 'COMPOSER_READY',
          controlId: 'ctrl_model_selector',
          actionKind: 'OPEN_UI',
          declaredPurpose: 'Abrir seletor Nano Banana 2.1 x2',
          paramsCanonical: {},
          preconditions: [],
          expectedPostconditions: [],
          timeoutMs: 5000,
          approvedForModes: ['bootstrap', 'explore'],
          risk: 'low',
          operatorId: 'op_mayk',
          observedConfigDigest: driver.computeConfigDigest(),
          policyVersion: envConfig.policy.policyVersion,
        },
        context
      );
      expect(bootRes.approved).toBe(true);
      expect(bootRes.transitionStatus).toBe('validated');

      const exploreValidator = new TransitionValidator({
        flowDb,
        safetyGateway: new DefaultSafetyGateway({
          policyEngine: new PolicyEngine(
            { ...envConfig.app, mode: 'explore' },
            envConfig.policy
          ),
          permitStore,
          eventRepo,
          lookupTransition: () => ({
            controlStatus: 'validated',
            transitionStatus: 'validated',
            observedMatches: 1,
            hasOperatorBootstrapApproval: true,
            approvedForModes: ['bootstrap', 'explore'],
          }),
          permitTtlMs: envConfig.policy.limits.permitTtlMs,
        }),
        executor,
      });

      const afterBoot = await driver.readLiveContextAndConfig();
      const expRes = await exploreValidator.executeAuthorizedExploreStep(
        {
          registryVersion: activeReg,
          transitionId: 'tr_open_model_selector',
          controlId: 'ctrl_model_selector',
          actionKind: 'OPEN_UI',
          paramsCanonical: {},
          policyVersion: envConfig.policy.policyVersion,
          observedConfigDigest: driver.computeConfigDigest(),
        },
        afterBoot.context
      );
      expect(expRes.executed).toBe(true);
      expect(expRes.postconditionVerified).toBe(true);

      const driftDetector = new DriftDetector(flowDb, eventRepo);
      const registryValidator = new RegistryValidator(flowDb, driftDetector, redactor);
      const afterExp = await driver.readLiveContextAndConfig();
      const valSummary = registryValidator.validateRegistryContext({
        registryVersion: activeReg,
        currentContext: afterExp.context,
        liveControls: driver.inspectControlsPassively(),
        policyVersion: envConfig.policy.policyVersion,
      });
      expect(valSummary.status).toBe('VALIDATED');
      expect(valSummary.counts.validatedControls).toBe(1);
      expect(valSummary.counts.validatedTransitions).toBe(1);
    } finally {
      flowDb.close();
    }
  });
});
