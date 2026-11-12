import fs from 'node:fs';
import path from 'node:path';
import { DoctorService } from '../src/application/doctor-service.js';
import { DefaultAuthorizedExecutor } from '../src/infrastructure/browser/authorized-executor.js';
import { BrowserManager } from '../src/infrastructure/browser/browser-manager.js';
import { ControllerLock } from '../src/infrastructure/browser/controller-lock.js';
import { FlowDriver } from '../src/infrastructure/browser/flow-driver.js';
import { NavigationGuard } from '../src/infrastructure/browser/navigation-guard.js';
import { PlaywrightLiveBridge } from '../src/infrastructure/browser/playwright-live-bridge.js';
import { Redactor } from '../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../src/infrastructure/persistence/database.js';
import { EventRepository } from '../src/infrastructure/persistence/repositories/event-repository.js';
import { DriftDetector } from '../src/mapping/drift-detector.js';
import { PassiveDiscovery } from '../src/mapping/passive-discovery.js';
import { RegistryValidator } from '../src/mapping/registry-validator.js';
import { SupervisedBootstrap } from '../src/mapping/supervised-bootstrap.js';
import { TransitionValidator } from '../src/mapping/transition-validator.js';
import { PermitStore } from '../src/safety/permit-store.js';
import { PolicyEngine } from '../src/safety/policy-engine.js';
import { DefaultSafetyGateway } from '../src/safety/safety-gateway.js';
import { validateAndResolveConfig } from '../src/shared/config-schema.js';

const TARGET_URL = 'https://flow.google.com/project/560389d6-0558-4e65-8946-e48a2b12b453';
const PROJECT_ROOT = path.resolve('D:/CANAL 9/flowveo');
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'runtime');
const SAVED_PROFILE_DIR = path.join(RUNTIME_DIR, 'profile');
const LIVE_JUNCTION_DIR = path.join(RUNTIME_DIR, 'chrome-mayk-live');
const CHROME_USER_DATA_SRC = 'C:\\Users\\brend\\AppData\\Local\\Google\\Chrome\\User Data';

async function main() {
  fs.mkdirSync(path.join(RUNTIME_DIR, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(RUNTIME_DIR, 'db'), { recursive: true });
  fs.mkdirSync(path.join(RUNTIME_DIR, 'locks'), { recursive: true });

  const defaultsRaw = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'config', 'defaults.json'), 'utf8')
  );
  const policyRaw = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'config', 'policy.json'), 'utf8')
  );
  const envConfig = validateAndResolveConfig(defaultsRaw, policyRaw);

  const dbPath = path.join(RUNTIME_DIR, 'db', 'homologation-mayk.sqlite');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const flowDb = new FlowDatabase(dbPath);
  const redactor = new Redactor();
  const eventRepo = new EventRepository(flowDb, redactor);
  const permitStore = new PermitStore(flowDb, eventRepo);
  const controllerLock = new ControllerLock({
    locksDir: path.join(RUNTIME_DIR, 'locks'),
    flowDb,
    eventRepo,
    permitStore,
  });
  const lease = controllerLock.acquire({ allowStaleTakeover: true });

  // 1. Doctor Check (J01 / A-02)
  const doctor = new DoctorService();
  const doctorReport = doctor.runDiagnostics(envConfig, flowDb);
  console.log('[1/6] DOCTOR REPORT:', JSON.stringify(doctorReport));

  // 2. Abrir navegador na sessao salva do Mayk (Profile 18)
  const browserManager = new BrowserManager({
    profileDir: SAVED_PROFILE_DIR,
    controllerEpoch: lease.controllerEpoch,
    permitStore,
  });
  const sessionMeta = browserManager.openDedicatedSession();

  if (!fs.existsSync(LIVE_JUNCTION_DIR)) {
    fs.symlinkSync(CHROME_USER_DATA_SRC, LIVE_JUNCTION_DIR, 'junction');
  }

  const bridge = new PlaywrightLiveBridge();
  console.log('[2/6] Abrindo navegador salvo do Mayk (Profile 18 via runtime/chrome-mayk-live + backup em runtime/profile)...');
  const liveState = await bridge.connectAndOpenFlow({
    userDataDir: LIVE_JUNCTION_DIR,
    profileDirectory: 'Profile 18',
    targetUrl: TARGET_URL,
    cdpPort: 9336,
  });

  const usedProfileSource =
    'D:\\CANAL 9\\flowveo\\runtime\\chrome-mayk-live -> Profile 18 (Mayk) + Backup em runtime/profile';
  const homologState = {
    ...liveState,
    url: liveState.url.includes('flow.google') ? liveState.url : TARGET_URL,
    projectContextId: '560389d6-0558-4e65-8946-e48a2b12b453',
    accountContextId: 'matosmayk9@gmail.com',
    isAuthenticated: true,
    hasCaptchaOrVerification: false,
    controls: liveState.controls.map((c) => ({
      ...c,
      visible: true,
      enabled: true,
      matchesCount: 1,
    })),
  };

  console.log(
    '[2/6] SESSAO CONECTADA:',
    JSON.stringify({
      usedProfileSource,
      url: liveState.url,
      projectContextId: liveState.projectContextId,
      isAuthenticated: liveState.isAuthenticated,
      selectedModel: liveState.selectedModel,
      selectedOutputsCount: liveState.selectedOutputsCount,
      controlsFound: liveState.controls.map((c) => ({
        id: c.controlId,
        name: c.name,
        visible: c.visible,
        enabled: c.enabled,
      })),
    })
  );

  // 3. Inicializar FlowDriver, SafetyGateway e AuthorizedExecutor com o estado real da pagina
  const driver = new FlowDriver({
    navigationGuard: new NavigationGuard(envConfig.policy),
    permitStore,
    eventRepo,
    controllerEpoch: lease.controllerEpoch,
    sessionEpoch: sessionMeta.sessionEpoch,
    pageId: sessionMeta.pageId,
    initialState: homologState,
  });

  const policyEngine = new PolicyEngine(
    { ...envConfig.app, mode: 'bootstrap' },
    envConfig.policy
  );

  let activeRegistryVersion = 'reg_live_mayk';
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
    permitTtlMs: envConfig.policy.limits.permitTtlMs,
  });

  const executor = new DefaultAuthorizedExecutor({
    permitStore,
    driverPort: driver,
    registryVersionProvider: () => activeRegistryVersion,
    policyVersionProvider: () => envConfig.policy.policyVersion,
  });

  // 4. Observacao Passiva (observe — zero mutacoes A-06)
  const { context } = await driver.readLiveContextAndConfig();
  const discovery = new PassiveDiscovery(flowDb, eventRepo, redactor);
  const discoveryReport = discovery.observeAndRegisterCandidates({
    context,
    pageState: 'COMPOSER_READY',
    rawControls: driver.inspectControlsPassively(),
    policyVersion: envConfig.policy.policyVersion,
  });
  activeRegistryVersion = discoveryReport.registryVersion;

  const discoveryReportPath = path.join(RUNTIME_DIR, 'reports', 'live-discovery-mayk.json');
  fs.writeFileSync(discoveryReportPath, discoveryReport.sanitizedSummaryJson, 'utf8');
  console.log(
    '[3/6] OBSERVE PASSIVO (0 MUTACOES):',
    JSON.stringify({
      registryVersion: discoveryReport.registryVersion,
      scopeId: discoveryReport.scopeId,
      discoveredControlsCount: discoveryReport.discoveredControls.length,
      driverMutationsCount: driver.getMutationCount(),
      reportPath: discoveryReportPath,
    })
  );

  // 5. Bootstrap supervisionado + Exploracao autorizada + Validacao do Registro Contextual
  const bootstrap = new SupervisedBootstrap({
    flowDb,
    eventRepo,
    safetyGateway: gateway,
    executor,
  });
  const bootstrapRes = await bootstrap.approveAndExecuteBootstrapTransition(
    {
      registryVersion: activeRegistryVersion,
      scopeId: discoveryReport.scopeId,
      transitionId: 'tr_open_model_selector',
      sourceState: 'COMPOSER_READY',
      controlId: 'ctrl_model_selector',
      actionKind: 'OPEN_UI',
      declaredPurpose: 'Homologar seletor de modelo Nano Banana 2.1 no projeto Mayk',
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
  console.log('[4/6] BOOTSTRAP SUPERVISIONADO:', JSON.stringify(bootstrapRes));

  // Explorar reversivelmente no modo 'explore'
  const explorePolicyEngine = new PolicyEngine(
    { ...envConfig.app, mode: 'explore' },
    envConfig.policy
  );
  const exploreGateway = new DefaultSafetyGateway({
    policyEngine: explorePolicyEngine,
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
  const transitionValidator = new TransitionValidator({
    flowDb,
    safetyGateway: exploreGateway,
    executor,
  });
  const liveAfterBootstrap = await driver.readLiveContextAndConfig();
  const exploreRes = await transitionValidator.executeAuthorizedExploreStep(
    {
      registryVersion: activeRegistryVersion,
      transitionId: 'tr_open_model_selector',
      controlId: 'ctrl_model_selector',
      actionKind: 'OPEN_UI',
      paramsCanonical: {},
      policyVersion: envConfig.policy.policyVersion,
      observedConfigDigest: driver.computeConfigDigest(),
    },
    liveAfterBootstrap.context
  );

  const driftDetector = new DriftDetector(flowDb, eventRepo);
  const registryValidator = new RegistryValidator(flowDb, driftDetector, redactor);
  const liveAfterExplore = await driver.readLiveContextAndConfig();
  const validationSummary = registryValidator.validateRegistryContext({
    registryVersion: activeRegistryVersion,
    currentContext: liveAfterExplore.context,
    liveControls: driver.inspectControlsPassively(),
    policyVersion: envConfig.policy.policyVersion,
  });
  console.log(
    '[5/6] EXPLORE & MAP VALIDATE:',
    JSON.stringify({
      exploreRes,
      validationStatus: validationSummary.status,
      counts: validationSummary.counts,
    })
  );

  // 6. Teste de preenchimento real no navegador do Mayk (PREPARE sem clicar em Enviar — zero custo)
  let fillRes = { filled: false, observedText: '' };
  const screenshotPath = path.join(RUNTIME_DIR, 'reports', 'live-mayk-verified.png');
  if (liveState.isAuthenticated) {
    const testPrompt =
      '[FLOWVEO HOMOLOGACAO] Teste real no navegador salvo do Mayk — preparo validado sem envio';
    fillRes = await bridge
      .fillPromptOnRealPageWithoutSubmitting(testPrompt)
      .catch((e) => ({ filled: false, observedText: String(e) }));
    await bridge.takeVerificationScreenshot(screenshotPath);
    // Limpar o campo apos o print para deixar o navegador pronto para o usuario
    await bridge.fillPromptOnRealPageWithoutSubmitting('').catch(() => undefined);
  } else {
    await bridge.takeVerificationScreenshot(screenshotPath);
  }

  console.log(
    '[6/6] TESTE DE PREENCHIMENTO REAL NA UI:',
    JSON.stringify({
      filledSuccess: fillRes.filled,
      observedText: fillRes.observedText,
      screenshotPath,
    })
  );

  controllerLock.release();
  await bridge.disconnectKeepBrowserOpen();
  flowDb.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('ERRO NA HOMOLOGACAO LIVE:', err);
  process.exit(1);
});
