import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { StartFrameValidator } from '../../src/domain/media/start-frame-validator.js';
import { StartFrameVideoWorkflow } from '../../src/execution/start-frame-video-workflow.js';
import { SubmissionLedger } from '../../src/execution/submission-ledger.js';
import { DefaultFlowReader } from '../../src/flow/flow-reader.js';
import { ArtifactStore } from '../../src/infrastructure/artifacts/artifact-store.js';
import { DownloadVerifier } from '../../src/infrastructure/artifacts/download-verifier.js';
import { DefaultAuthorizedExecutor } from '../../src/infrastructure/browser/authorized-executor.js';
import { FlowDriver } from '../../src/infrastructure/browser/flow-driver.js';
import { NavigationGuard } from '../../src/infrastructure/browser/navigation-guard.js';
import { Redactor } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { BudgetGuard } from '../../src/safety/budget-guard.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import { PolicyEngine } from '../../src/safety/policy-engine.js';
import { DefaultSafetyGateway } from '../../src/safety/safety-gateway.js';
import { validateAndResolveConfig } from '../../src/shared/config-schema.js';
import { PolicyDeniedError } from '../../src/shared/errors.js';

function createValid16x9PngBuffer(seed: string): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from('IHDR', 'ascii');
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1920, 0);
  ihdrData.writeUInt32BE(1080, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const body = Buffer.alloc(128, `pov-start-frame-1920x1080-${seed}`);
  return Buffer.concat([signature, ihdrLen, ihdrType, ihdrData, body]);
}

function createValidMp4Buffer(): Buffer {
  const buf = Buffer.alloc(8192, 0);
  buf.writeUInt32BE(24, 0);
  buf.write('ftypisom', 4, 'ascii');
  return buf;
}

describe('Subetapas SF-2 a SF-6 — StartFrameVideoWorkflow no Google Flow (Estilo Firefly)', () => {
  it('executa prepare (SF-2..SF-4) trocando Nano Banana -> Veo 2, anexando Start Frame no botao + e parando com 0 envios', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-sf-prep-'));
    const framesDir = path.join(tmpDir, 'start_frames');
    fs.mkdirSync(framesDir, { recursive: true });
    fs.writeFileSync(
      path.join(framesDir, 'p01_diluvio_pov.png'),
      createValid16x9PngBuffer('diluvio_p01')
    );

    const env = validateAndResolveConfig(
      {
        mode: 'prepare',
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
        runtimeDir: tmpDir,
      },
      {
        policyVersion: '1.0.0',
        releasePhase: 'B',
        allowedWorkOrigins: ['https://flow.google.com'],
        allowedLoginOrigins: ['https://accounts.google.com'],
        authorizedProjects: ['560389d6-0558-4e65-8946-e48a2b12b453'],
        authorizedAccounts: ['matosmayk9@gmail.com'],
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
      }
    );

    const flowDb = new FlowDatabase(env.resolvedPaths.databaseFile);
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);
    const permitStore = new PermitStore(flowDb, eventRepo);

    try {
      const driver = new FlowDriver({
        navigationGuard: new NavigationGuard(env.policy),
        permitStore,
        eventRepo,
        controllerEpoch: 1,
        sessionEpoch: 1,
        pageId: 'page_mayk_sf',
        initialState: {
          url: 'https://flow.google.com/project/560389d6-0558-4e65-8946-e48a2b12b453',
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
        registryVersionProvider: () => 'reg_sf_1',
        policyVersionProvider: () => '1.0.0',
      });
      const budgetGuard = new BudgetGuard(flowDb, env.policy);
      const ledger = new SubmissionLedger(flowDb, eventRepo, budgetGuard);
      const artifactStore = new ArtifactStore({
        flowDb,
        eventRepo,
        artifactsBaseDir: env.resolvedPaths.artifactsDir,
        stagingBaseDir: env.resolvedPaths.stagingDir,
      });
      const verifier = new DownloadVerifier({ artifactStore });
      const validator = new StartFrameValidator({ allowedBaseDir: framesDir });

      const workflow = new StartFrameVideoWorkflow({
        reader,
        safetyGateway: gateway,
        executor,
        startFrameValidator: validator,
        ledger,
        artifactStore,
        verifier,
        registryVersion: 'reg_sf_1',
        policyVersion: '1.0.0',
      });

      // Rejeitar modelo de imagem ('Nano Banana 2.1') quando se exige geracao de video
      await expect(
        workflow.prepareStartFrameVideo({
          jobId: 'job_sf_bad_model',
          projectContextId: '560389d6-0558-4e65-8946-e48a2b12b453',
          accountContextId: 'matosmayk9@gmail.com',
          startFrameRelativePath: 'p01_diluvio_pov.png',
          rawMotionPrompt: 'First-person POV forward motion on the reed boat bow',
          targetVideoModel: 'Nano Banana 2.1',
          aspectRatio: '16:9',
          requestedOutputs: 1,
        })
      ).rejects.toThrow(PolicyDeniedError);

      // Executar prepare com modelo de video 'Veo 2'
      const prep = await workflow.prepareStartFrameVideo({
        jobId: 'job_sf_prep_01',
        projectContextId: '560389d6-0558-4e65-8946-e48a2b12b453',
        accountContextId: 'matosmayk9@gmail.com',
        startFrameRelativePath: 'p01_diluvio_pov.png',
        rawMotionPrompt:
          'First-person POV 24mm camera gripping the reed boat steering frame as waves splash across the bow',
        targetVideoModel: 'Veo 2',
        aspectRatio: '16:9',
        requestedOutputs: 1,
      });

      expect(prep.status).toBe('PREPARED');
      expect(prep.selectedModel).toBe('Veo 2');
      expect(prep.selectedAspectRatio).toBe('16:9');
      expect(prep.selectedOutputsCount).toBe(1);
      expect(prep.uploadReadyFilename).toBe('p01_diluvio_pov.png');
      expect(prep.submissionsTriggered).toBe(0);
    } finally {
      flowDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('executa o ciclo completo SF-1 a SF-6: Start Frame -> Veo 2 -> Upload -> Prompt POV -> Submit -> Download .part -> .mp4 verificado por ffprobe', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-sf-run-'));
    const framesDir = path.join(tmpDir, 'start_frames');
    fs.mkdirSync(framesDir, { recursive: true });
    fs.writeFileSync(
      path.join(framesDir, 'p27_diluvio_pov.png'),
      createValid16x9PngBuffer('diluvio_p27')
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
        runtimeDir: tmpDir,
      },
      {
        policyVersion: '1.0.0',
        releasePhase: 'B',
        allowedWorkOrigins: ['https://flow.google.com'],
        allowedLoginOrigins: ['https://accounts.google.com'],
        authorizedProjects: ['560389d6-0558-4e65-8946-e48a2b12b453'],
        authorizedAccounts: ['matosmayk9@gmail.com'],
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
      }
    );

    const flowDb = new FlowDatabase(env.resolvedPaths.databaseFile);
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);
    const permitStore = new PermitStore(flowDb, eventRepo);

    try {
      const driver = new FlowDriver({
        navigationGuard: new NavigationGuard(env.policy),
        permitStore,
        eventRepo,
        controllerEpoch: 1,
        sessionEpoch: 1,
        pageId: 'page_mayk_run',
        initialState: {
          url: 'https://flow.google.com/project/560389d6-0558-4e65-8946-e48a2b12b453',
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
        registryVersionProvider: () => 'reg_sf_1',
        policyVersionProvider: () => '1.0.0',
      });
      const budgetGuard = new BudgetGuard(flowDb, env.policy);
      const ledger = new SubmissionLedger(flowDb, eventRepo, budgetGuard);
      const artifactStore = new ArtifactStore({
        flowDb,
        eventRepo,
        artifactsBaseDir: env.resolvedPaths.artifactsDir,
        stagingBaseDir: env.resolvedPaths.stagingDir,
      });
      const verifier = new DownloadVerifier({
        artifactStore,
        ffprobeRunner: async () => ({
          containerFormat: 'mp4',
          durationSec: 8.0,
          width: 1920,
          height: 1080,
        }),
      });
      const validator = new StartFrameValidator({ allowedBaseDir: framesDir });

      const workflow = new StartFrameVideoWorkflow({
        reader,
        safetyGateway: gateway,
        executor,
        startFrameValidator: validator,
        ledger,
        artifactStore,
        verifier,
        registryVersion: 'reg_sf_1',
        policyVersion: '1.0.0',
      });

      const completed = await workflow.runAndDownloadStartFrameVideo({
        spec: {
          jobId: 'job_sf_p27_diluvio',
          projectContextId: '560389d6-0558-4e65-8946-e48a2b12b453',
          accountContextId: 'matosmayk9@gmail.com',
          startFrameRelativePath: 'p27_diluvio_pov.png',
          rawMotionPrompt:
            'First-person POV holding barley seeds in left palm while right hand grips the wet reed boat steering frame in heavy rain',
          targetVideoModel: 'Veo 2',
          aspectRatio: '16:9',
          requestedOutputs: 1,
        },
        videoPayloadBytes: createValidMp4Buffer(),
      });

      expect(completed.status).toBe('COMPLETED');
      expect(completed.artifact.status).toBe('VERIFIED');
      expect(completed.artifact.containerFormat).toBe('mp4');
      expect(completed.artifact.width).toBe(1920);
      expect(completed.artifact.height).toBe(1080);
      expect(completed.artifact.durationSec).toBe(8.0);
      expect(fs.existsSync(completed.artifact.finalPath)).toBe(true);
      expect(completed.chainLink.verifiedChainDigest).toHaveLength(64);
    } finally {
      flowDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
