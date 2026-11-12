import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DoctorService } from '../../src/application/doctor-service.js';
import { ExecutionService } from '../../src/application/execution-service.js';
import { MappingService } from '../../src/application/mapping-service.js';
import { RecoveryService } from '../../src/application/recovery-service.js';
import { JobOrchestrator } from '../../src/execution/job-orchestrator.js';
import { RemoteReconciler } from '../../src/execution/remote-reconciler.js';
import { SubmissionLedger } from '../../src/execution/submission-ledger.js';
import { DefaultActionPlanner, computeObservedConfigDigest } from '../../src/flow/action-planner.js';
import { DefaultFlowReader } from '../../src/flow/flow-reader.js';
import { ArtifactStore } from '../../src/infrastructure/artifacts/artifact-store.js';
import { DownloadVerifier } from '../../src/infrastructure/artifacts/download-verifier.js';
import { LocalArtifactReconciler } from '../../src/infrastructure/artifacts/local-reconciler.js';
import { DefaultAuthorizedExecutor } from '../../src/infrastructure/browser/authorized-executor.js';
import { ControllerLock } from '../../src/infrastructure/browser/controller-lock.js';
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
import { BudgetGuard } from '../../src/safety/budget-guard.js';
import { CircuitBreaker } from '../../src/safety/circuit-breaker.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import { PolicyEngine } from '../../src/safety/policy-engine.js';
import { DefaultSafetyGateway } from '../../src/safety/safety-gateway.js';
import { StopController } from '../../src/safety/stop-controller.js';
import { validateAndResolveConfig } from '../../src/shared/config-schema.js';

function createMp4Bytes(): Buffer {
  const b = Buffer.alloc(4096, 0);
  b.writeUInt32BE(24, 0);
  b.write('ftypisom', 4, 'ascii');
  return b;
}

describe('Gate G10 — Stress & E2E Acceptance: Complete Lifecycle G1 -> G10 (Doctor -> Observe -> Bootstrap -> Validate -> DryRun -> Prepare -> Execute -> Verify -> Reconcile)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('executa de ponta a ponta todas as fases G1..G10 validando o Definition of Done completo', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g10-e2e-'));
    tempDirs.push(tmpDir);

    // 1. G1: Configuracao validada + SQLite WAL + Redactor
    const resolvedEnv = validateAndResolveConfig(
      {
        mode: 'execute',
        releasePhase: 'C',
        executionEnabled: true,
        maxConcurrentJobs: 1,
        maxSubmissionsPerRun: 3,
        maxRequestedOutputsPerRun: 6,
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
        releasePhase: 'C',
        allowedWorkOrigins: ['https://labs.google'],
        allowedLoginOrigins: ['https://accounts.google.com'],
        authorizedProjects: ['proj_1'],
        authorizedAccounts: ['acc_1'],
        limits: {
          maxSubmissionsPerRun: 3,
          maxSubmissionsPerWindow: 3,
          windowDurationMs: 3600000,
          maxRequestedOutputsPerRun: 6,
          maxActiveJobs: 1,
          minFreeDiskBytes: 524288000,
          maxDownloadBytesPerSession: 1073741824,
          maxSessionDurationMs: 3600000,
          maxActionsPerSession: 500,
          permitTtlMs: 15000,
          maxDownloadRetries: 2,
          maxConsecutiveFailures: 3,
        },
      }
    );

    const db = new FlowDatabase(resolvedEnv.resolvedPaths.databaseFile);
    const redactor = new Redactor();
    const eventRepo = new EventRepository(db, redactor);
    const permitStore = new PermitStore(db, eventRepo);
    const lock = new ControllerLock({
      locksDir: resolvedEnv.resolvedPaths.locksDir,
      flowDb: db,
      eventRepo,
      permitStore,
    });
    const lease = lock.acquire();

    try {
      // 2. G4: DoctorService
      const doctor = new DoctorService();
      const docReport = doctor.runDiagnostics(resolvedEnv, db, 1024 * 1024 * 1024);
      expect(docReport.overallReadyForObservation).toBe(true);
      expect(docReport.generationHomologated).toBe(false);

      // 3. G3/G4/G5/G6: FlowDriver + MappingService (Observe -> Bootstrap -> Validate)
      const policyEngine = new PolicyEngine(resolvedEnv.app, resolvedEnv.policy);
      const navGuard = new NavigationGuard(resolvedEnv.policy);

      const driver = new FlowDriver({
        navigationGuard: navGuard,
        permitStore,
        eventRepo,
        controllerEpoch: lease.controllerEpoch,
        sessionEpoch: 1,
        pageId: 'page_e2e',
        initialState: {
          url: 'https://labs.google/fx/pt/tools/flow/project/proj_1',
          locale: 'pt-BR',
          viewport: { width: 1440, height: 900 },
          accountContextId: 'acc_1',
          projectContextId: 'proj_1',
          creationMode: 'TEXT_TO_VIDEO',
          observedVariant: 'v1',
          isAuthenticated: true,
          hasCaptchaOrVerification: false,
          humanInterferenceDetected: false,
          selectedModel: 'veo-2',
          selectedAspectRatio: '16:9',
          selectedOutputsCount: 2,
          promptText: '',
          uploadReadyFilename: null,
          observedRevision: 1,
          controls: [
            {
              controlId: 'ctrl_model_selector',
              containerId: 'composer',
              role: 'button',
              name: 'Model',
              label: 'Select Model',
              visible: true,
              enabled: true,
              matchesCount: 1,
            },
            {
              controlId: 'ctrl_aspect_and_outputs',
              containerId: 'composer',
              role: 'button',
              name: 'Aspect Ratio',
              label: 'Select Aspect',
              visible: true,
              enabled: true,
              matchesCount: 1,
            },
            {
              controlId: 'ctrl_prompt_textarea',
              containerId: 'composer',
              role: 'textbox',
              name: 'Prompt',
              label: 'Enter Prompt',
              visible: true,
              enabled: true,
              matchesCount: 1,
            },
            {
              controlId: 'ctrl_submit_generate',
              containerId: 'composer',
              role: 'button',
              name: 'Generate',
              label: 'Generate Video',
              visible: true,
              enabled: true,
              matchesCount: 1,
            },
            {
              controlId: 'ctrl_download_0',
              containerId: 'results',
              role: 'button',
              name: 'Download 0',
              label: 'Download Video 0',
              visible: true,
              enabled: true,
              matchesCount: 1,
            },
            {
              controlId: 'ctrl_download_1',
              containerId: 'results',
              role: 'button',
              name: 'Download 1',
              label: 'Download Video 1',
              visible: true,
              enabled: true,
              matchesCount: 1,
            },
          ],
          results: [],
          isResultsVirtualizedOrPartial: false,
        },
      });

      let activeRegVersion = 'reg_e2e_v1';
      const safetyGateway = new DefaultSafetyGateway({
        policyEngine,
        permitStore,
        eventRepo,
        lookupTransition: () => ({
          transitionStatus: 'validated',
          controlStatus: 'validated',
          observedMatches: 1,
          hasOperatorBootstrapApproval: true,
          approvedForModes: ['bootstrap', 'explore', 'prepare', 'execute'],
        }),
        permitTtlMs: 15000,
      });

      const authorizedExecutor = new DefaultAuthorizedExecutor({
        permitStore,
        driverPort: driver,
        registryVersionProvider: () => activeRegVersion,
        policyVersionProvider: () => '1.0.0',
      });

      const flowReader = new DefaultFlowReader(driver, { maxReadRetries: 2 });
      const passiveDiscovery = new PassiveDiscovery(db, eventRepo, redactor);
      const bootstrap = new SupervisedBootstrap({
        flowDb: db,
        eventRepo,
        safetyGateway,
        executor: authorizedExecutor,
      });
      const transitionValidator = new TransitionValidator({
        flowDb: db,
        safetyGateway,
        executor: authorizedExecutor,
      });
      const driftDetector = new DriftDetector(db, eventRepo);
      const registryValidator = new RegistryValidator(db, driftDetector, redactor);

      const mappingService = new MappingService({
        flowReader,
        passiveDiscovery,
        supervisedBootstrap: bootstrap,
        transitionValidator,
        registryValidator,
        inspectControlsFn: () => driver.inspectControlsPassively(),
      });

      const obsReport = await mappingService.observe('COMPOSER_READY', '1.0.0');
      activeRegVersion = obsReport.registryVersion;
      expect(obsReport.discoveredControls).toHaveLength(6);

      // 4. G7/G8/G9/G10: Enqueue, DryRun, Prepare, Execute, Collect, Verify & Reconcile
      const budgetGuard = new BudgetGuard(db, resolvedEnv.policy);
      const ledger = new SubmissionLedger(db, eventRepo, budgetGuard);
      const artifactStore = new ArtifactStore({
        flowDb: db,
        eventRepo,
        artifactsBaseDir: resolvedEnv.resolvedPaths.artifactsDir,
        stagingBaseDir: resolvedEnv.resolvedPaths.stagingDir,
      });
      const verifier = new DownloadVerifier({ artifactStore });
      const localReconciler = new LocalArtifactReconciler(artifactStore);
      const planner = new DefaultActionPlanner();

      const promptText = 'E2E Scene 1: Ancient flood wall POV';
      const promptDigest = sha256Hex(promptText);

      // Reader e Executor coordenados com o FlowDriver para o ciclo E2E completo de geracao + coleta
      let submitted = false;
      const e2eReader = {
        inspectContext: async () => (await driver.readLiveContextAndConfig()).context,
        inspectCreationForm: async () => {
          const live = await driver.readLiveContextAndConfig();
          return {
            ...live.creation,
            observedConfigDigest: computeObservedConfigDigest({
              projectContextId: live.context.projectContextId,
              model: live.creation.selectedModel,
              aspectRatio: live.creation.selectedAspectRatio,
              requestedOutputs: live.creation.selectedOutputsCount,
              promptDigestSha256: live.creation.promptDigestSha256,
            }),
          };
        },
        inspectResults: async () => {
          if (!submitted) return { isVirtualizedOrPartial: false, items: [] };
          return {
            isVirtualizedOrPartial: false,
            items: [
              {
                remoteExternalId: 'rem_e2e_1',
                remoteAssetId: 'asset_e2e_0',
                resultIndex: 0,
                status: 'READY' as const,
                promptSnippetDigest: promptDigest,
                createdAtLabel: 'Just now',
                downloadControlId: 'ctrl_download_0',
              },
              {
                remoteExternalId: 'rem_e2e_1',
                remoteAssetId: 'asset_e2e_1',
                resultIndex: 1,
                status: 'READY' as const,
                promptSnippetDigest: promptDigest,
                createdAtLabel: 'Just now',
                downloadControlId: 'ctrl_download_1',
              },
            ],
          };
        },
      };

      const e2eExecutor = {
        execute: async (permitId: string) => {
          const { permit, plan } = permitStore.getPermitAndPlan(permitId);
          if (permit.targetControlId === 'ctrl_model_selector') {
            driver.updateSimulatedPageState({ selectedModel: String(plan.paramsCanonical.model) });
          } else if (permit.targetControlId === 'ctrl_aspect_and_outputs') {
            driver.updateSimulatedPageState({
              selectedAspectRatio: String(plan.paramsCanonical.aspectRatio),
              selectedOutputsCount: Number(plan.paramsCanonical.requestedOutputs),
            });
          } else if (permit.targetControlId === 'ctrl_prompt_textarea') {
            driver.updateSimulatedPageState({
              promptText: String(plan.paramsCanonical.promptText),
            });
          } else if (permit.actionKind === 'SUBMIT') {
            submitted = true;
          }
          return {
            permitId,
            planId: plan.planId,
            actionKind: permit.actionKind,
            status: 'SUCCESS' as const,
            observedRevisionAfter: 1,
            postconditionVerified: true,
            details: {},
          };
        },
      };

      const executionService = new ExecutionService({
        reader: e2eReader,
        planner,
        safetyGateway,
        executor: e2eExecutor,
        ledger,
        reconciler: new RemoteReconciler(),
        registryVersion: activeRegVersion,
        policyVersion: '1.0.0',
        mode: 'execute',
      });

      const recoveryService = new RecoveryService({
        flowDb: db,
        ledger,
        permitStore,
        artifactStore,
        verifier,
        localReconciler,
        reader: e2eReader,
        planner,
        safetyGateway,
        executor: e2eExecutor,
        downloadProvider: async () => ({
          suggestedFilename: 'flow_output.mp4',
          bytes: createMp4Bytes(),
        }),
        registryVersion: activeRegVersion,
        policyVersion: '1.0.0',
      });

      const circuitBreaker = new CircuitBreaker({
        flowDb: db,
        eventRepo,
        maxConsecutiveFailures: 3,
      });

      const stopController = new StopController(permitStore);
      const orchestrator = new JobOrchestrator({
        flowDb: db,
        ledger,
        executionService,
        recoveryService,
        circuitBreaker,
        stopController,
      });

      const job1 = ledger.createJob({
        prompt: promptText,
        model: 'veo-2',
        aspectRatio: '16:9',
        requestedOutputs: 2,
        projectContextId: 'proj_1',
        accountContextId: 'acc_1',
        completionPolicy: {
          minVerifiedOutputs: 2,
          allowPartial: false,
          technicalRequirements: { minSizeBytes: 1024, expectedContainer: 'mp4' },
        },
      });

      // Dry-run primeiro (0 cliques)
      const dryReport = await executionService.dryRunJob(job1.jobId);
      expect(dryReport.mutationsExecuted).toBe(0);
      expect(submitted).toBe(false);

      // Execucao completa via JobOrchestrator
      const batchSummary = await orchestrator.runSerialBatch([job1.jobId], lease.controllerEpoch);
      expect(batchSummary.completedJobIds).toEqual([job1.jobId]);
      expect(batchSummary.haltedJobId).toBeNull();

      const completedJob = ledger.getJobById(job1.jobId);
      expect(completedJob.status).toBe('COMPLETED');
      expect(completedJob.phase).toBe('DONE');

      const jobArtifacts = artifactStore.listArtifactsByJob(job1.jobId);
      expect(jobArtifacts).toHaveLength(2);
      expect(jobArtifacts.every((a) => a.status === 'VERIFIED')).toBe(true);

      const recReport = recoveryService.reconcileLocalArtifacts();
      expect(recReport.verifiedIntactCount).toBe(2);
      expect(recReport.markedMissingArtifactIds).toHaveLength(0);
      expect(recReport.orphanFilesOnDisk).toHaveLength(0);
    } finally {
      lock.release();
      db.close();
    }
  });
});
