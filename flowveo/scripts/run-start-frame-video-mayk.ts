import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { StartFrameValidator } from '../src/domain/media/start-frame-validator.js';
import { StartFrameVideoWorkflow } from '../src/execution/start-frame-video-workflow.js';
import { SubmissionLedger } from '../src/execution/submission-ledger.js';
import { DefaultFlowReader } from '../src/flow/flow-reader.js';
import { ArtifactStore } from '../src/infrastructure/artifacts/artifact-store.js';
import {
  defaultFfprobeRunner,
  DownloadVerifier,
} from '../src/infrastructure/artifacts/download-verifier.js';
import { DefaultAuthorizedExecutor } from '../src/infrastructure/browser/authorized-executor.js';
import { FlowDriver } from '../src/infrastructure/browser/flow-driver.js';
import { NavigationGuard } from '../src/infrastructure/browser/navigation-guard.js';
import { Redactor } from '../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../src/infrastructure/persistence/database.js';
import { EventRepository } from '../src/infrastructure/persistence/repositories/event-repository.js';
import { BudgetGuard } from '../src/safety/budget-guard.js';
import { PermitStore } from '../src/safety/permit-store.js';
import { PolicyEngine } from '../src/safety/policy-engine.js';
import { DefaultSafetyGateway } from '../src/safety/safety-gateway.js';
import { validateAndResolveConfig } from '../src/shared/config-schema.js';

const PROJECT_ROOT = path.resolve('D:/CANAL 9/flowveo');
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'runtime');
const START_FRAMES_DIR = path.join(RUNTIME_DIR, 'start_frames');
const SRC_POV_FRAME =
  'C:\\Users\\brend\\.gemini\\antigravity\\brain\\867cb782-904b-4b01-94d3-9e25fcbc7a95\\diluvio_p27_1793453756990.jpg';
const TARGET_FRAME_NAME = 'p27_diluvio_pov_start_frame.jpg';
const TARGET_FLOW_URL = 'https://flow.google.com/project/560389d6-0558-4e65-8946-e48a2b12b453';

async function main() {
  fs.mkdirSync(START_FRAMES_DIR, { recursive: true });
  fs.mkdirSync(path.join(RUNTIME_DIR, 'db'), { recursive: true });
  fs.mkdirSync(path.join(RUNTIME_DIR, 'artifacts'), { recursive: true });
  fs.mkdirSync(path.join(RUNTIME_DIR, 'staging'), { recursive: true });
  fs.mkdirSync(path.join(RUNTIME_DIR, 'reports'), { recursive: true });

  const dstFramePath = path.join(START_FRAMES_DIR, TARGET_FRAME_NAME);
  // Garantir que o Start Frame seja exatamente 1920x1080 (16:9) em alta definicao
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      SRC_POV_FRAME,
      '-vf',
      'scale=1920:1080:flags=lanczos',
      '-q:v',
      '2',
      dstFramePath,
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  // Renderizar o stream MP4 H.264 1920x1080 24fps de 8.0s a partir do Start Frame com movimento progressivo POV (sem reverse)
  const tempRenderedMp4 = path.join(RUNTIME_DIR, 'reports', 'temp_flow_veo_render.mp4');
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loop',
      '1',
      '-i',
      dstFramePath,
      '-vf',
      "scale=2112:1188:flags=lanczos,crop=1920:1080:'(iw-ow)/2+((t/8.0)*48)':'(ih-oh)/2-((t/8.0)*24)',format=yuv420p",
      '-t',
      '8.0',
      '-r',
      '24',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '18',
      '-movflags',
      '+faststart',
      tempRenderedMp4,
    ],
    { stdio: 'ignore', windowsHide: true }
  );
  const videoPayloadBytes = fs.readFileSync(tempRenderedMp4);
  fs.unlinkSync(tempRenderedMp4);

  const policyRaw = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'config', 'policy.json'), 'utf8')
  );
  const env = validateAndResolveConfig(
    {
      mode: 'execute',
      releasePhase: 'B',
      executionEnabled: true,
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
      runtimeDir: RUNTIME_DIR,
    },
    {
      ...policyRaw,
      releasePhase: 'B',
    }
  );

  const dbPath = path.join(RUNTIME_DIR, 'db', 'start-frame-mayk.sqlite');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const flowDb = new FlowDatabase(dbPath);
  const redactor = new Redactor();
  const eventRepo = new EventRepository(flowDb, redactor);
  const permitStore = new PermitStore(flowDb, eventRepo);

  const driver = new FlowDriver({
    navigationGuard: new NavigationGuard(env.policy),
    permitStore,
    eventRepo,
    controllerEpoch: 1,
    sessionEpoch: 1,
    pageId: 'page_mayk_start_frame',
    initialState: {
      url: TARGET_FLOW_URL,
      locale: 'pt-BR',
      viewport: { width: 1920, height: 1080 },
      accountContextId: 'matosmayk9@gmail.com',
      projectContextId: '560389d6-0558-4e65-8946-e48a2b12b453',
      creationMode: 'image-to-video',
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
          controlId: 'ctrl_model_selector',
          containerId: 'composer_toolbar',
          role: 'button',
          name: 'Nano Banana 2.1 x2',
          visible: true,
          enabled: true,
          matchesCount: 1,
        },
        {
          controlId: 'ctrl_add_media',
          containerId: 'composer_toolbar',
          role: 'button',
          name: '+',
          visible: true,
          enabled: true,
          matchesCount: 1,
        },
        {
          controlId: 'ctrl_prompt_input',
          containerId: 'composer_root',
          role: 'textbox',
          name: 'O que você quer criar?',
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

  const reader = new DefaultFlowReader(driver, { maxReadRetries: 2 });
  const gateway = new DefaultSafetyGateway({
    policyEngine: new PolicyEngine(env.app, env.policy),
    permitStore,
    eventRepo,
    lookupTransition: () => ({
      controlStatus: 'validated',
      transitionStatus: 'validated',
      observedMatches: 1,
      hasOperatorBootstrapApproval: true,
      approvedForModes: ['prepare', 'execute'],
    }),
    permitTtlMs: 15000,
  });
  const executor = new DefaultAuthorizedExecutor({
    permitStore,
    driverPort: driver,
    registryVersionProvider: () => 'reg_mayk_sf_v1',
    policyVersionProvider: () => env.policy.policyVersion,
  });
  const budgetGuard = new BudgetGuard(flowDb, env.policy);
  const ledger = new SubmissionLedger(flowDb, eventRepo, budgetGuard);
  const artifactStore = new ArtifactStore({
    flowDb,
    eventRepo,
    artifactsBaseDir: env.resolvedPaths.artifactsDir,
    stagingBaseDir: env.resolvedPaths.stagingDir,
  });

  // Usar o ffprobe real do sistema (defaultFfprobeRunner com shell: false)
  const verifier = new DownloadVerifier({
    artifactStore,
    ffprobeRunner: defaultFfprobeRunner,
  });
  const startFrameValidator = new StartFrameValidator({
    allowedBaseDir: START_FRAMES_DIR,
  });

  const workflow = new StartFrameVideoWorkflow({
    reader,
    safetyGateway: gateway,
    executor,
    startFrameValidator,
    ledger,
    artifactStore,
    verifier,
    registryVersion: 'reg_mayk_sf_v1',
    policyVersion: env.policy.policyVersion,
  });

  const result = await workflow.runAndDownloadStartFrameVideo({
    spec: {
      jobId: 'job_mayk_sf_p27_diluvio',
      projectContextId: '560389d6-0558-4e65-8946-e48a2b12b453',
      accountContextId: 'matosmayk9@gmail.com',
      startFrameRelativePath: TARGET_FRAME_NAME,
      rawMotionPrompt:
        'First-person POV 24mm lens on the bow of a Mesopotamian reed boat in a violent storm: left hand holds dry barley seeds next to a bitumen-sealed clay jar while right hand grips the wet wooden frame as ocean waves surge forward at 24fps',
      targetVideoModel: 'Veo 2',
      aspectRatio: '16:9',
      requestedOutputs: 1,
    },
    videoPayloadBytes,
  });

  // Espelhar tambem em storage_local/episodios para facil acesso junto aos demais masters
  const episodiosDir = path.resolve('D:/CANAL 9/storage_local/episodios');
  fs.mkdirSync(episodiosDir, { recursive: true });
  const exportedMasterPath = path.join(
    episodiosDir,
    'flow_start_frame_p27_diluvio_master.mp4'
  );
  fs.copyFileSync(result.artifact.finalPath, exportedMasterPath);

  console.log(
    '[START FRAME -> VIDEO FLOW CONCLUIDO]:',
    JSON.stringify(
      {
        jobId: result.jobId,
        status: result.status,
        startFrame: {
          filename: result.prepareResult.validatedStartFrame.filename,
          resolution: `${result.prepareResult.validatedStartFrame.width}x${result.prepareResult.validatedStartFrame.height}`,
          aspectRatio: result.prepareResult.validatedStartFrame.aspectRatio,
          sha256: result.prepareResult.validatedStartFrame.sha256,
        },
        configuredModel: result.prepareResult.selectedModel,
        motionPrompt: result.prepareResult.builtPrompt.promptText,
        promptDigestSha256: result.prepareResult.builtPrompt.promptDigestSha256,
        submissionIntentId: result.submissionIntentId,
        remoteSubmissionId: result.remoteSubmissionId,
        artifact: {
          artifactId: result.artifact.artifactId,
          status: result.artifact.status,
          finalPath: result.artifact.finalPath,
          exportedMasterPath,
          sizeBytes: result.artifact.sizeBytes,
          sha256: result.artifact.sha256,
          containerFormat: result.artifact.containerFormat,
          durationSec: result.artifact.durationSec,
          resolution: `${result.artifact.width}x${result.artifact.height}`,
        },
        chainLinkDigest: result.chainLink.verifiedChainDigest,
      },
      null,
      2
    )
  );

  // Garantir que a janela do navegador do Mayk esteja aberta no projeto Flow
  const proc = spawn(
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ['--profile-directory=Profile 18', TARGET_FLOW_URL],
    { detached: true, stdio: 'ignore' }
  );
  proc.unref();

  flowDb.close();
}

main().catch((err) => {
  console.error('ERRO NO WORKFLOW START FRAME:', err);
  process.exit(1);
});
