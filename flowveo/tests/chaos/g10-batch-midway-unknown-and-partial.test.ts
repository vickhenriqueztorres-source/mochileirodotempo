import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecutionService } from '../../src/application/execution-service.js';
import { RecoveryService } from '../../src/application/recovery-service.js';
import type { ActionOutcome } from '../../src/domain/actions/action-types.js';
import { JobOrchestrator } from '../../src/execution/job-orchestrator.js';
import { RemoteReconciler } from '../../src/execution/remote-reconciler.js';
import { SubmissionLedger } from '../../src/execution/submission-ledger.js';
import { DefaultActionPlanner, computeObservedConfigDigest } from '../../src/flow/action-planner.js';
import type { AuthorizedExecutor, FlowReader } from '../../src/flow/contracts.js';
import { ArtifactStore } from '../../src/infrastructure/artifacts/artifact-store.js';
import { DownloadVerifier } from '../../src/infrastructure/artifacts/download-verifier.js';
import { LocalArtifactReconciler } from '../../src/infrastructure/artifacts/local-reconciler.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { BudgetGuard } from '../../src/safety/budget-guard.js';
import { CircuitBreaker } from '../../src/safety/circuit-breaker.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import { PolicyEngine } from '../../src/safety/policy-engine.js';
import { DefaultSafetyGateway } from '../../src/safety/safety-gateway.js';
import { StopController } from '../../src/safety/stop-controller.js';
import type { PolicyConfig } from '../../src/shared/config-schema.js';

function makeMp4(): Buffer {
  const b = Buffer.alloc(2048, 0);
  b.writeUInt32BE(24, 0);
  b.write('ftypisom', 4, 'ascii');
  return b;
}

describe('Gate G10 — Chaos: Batch Halts Immediately on Midway UNKNOWN & Partial Job Completion (BC-10, BC-11, BC-18)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  function buildChaosHarness(mode: 'TIMEOUT_ON_JOB_1' | 'PARTIAL_2_OF_3') {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g10-chaos-'));
    tempDirs.push(tmpDir);

    const db = new FlowDatabase(path.join(tmpDir, 'chaos.sqlite'));
    const eventRepo = new EventRepository(db, new Redactor());
    const policyConfig: PolicyConfig = {
      policyVersion: '1.0.0',
      releasePhase: 'C',
      allowedWorkOrigins: ['https://labs.google'],
      allowedLoginOrigins: ['https://accounts.google.com'],
      authorizedProjects: ['proj_1'],
      authorizedAccounts: ['acc_1'],
      limits: {
        maxSubmissionsPerRun: 5,
        maxSubmissionsPerWindow: 5,
        windowDurationMs: 3600000,
        maxRequestedOutputsPerRun: 10,
        maxActiveJobs: 1,
        minFreeDiskBytes: 524288000,
        maxDownloadBytesPerSession: 1073741824,
        maxSessionDurationMs: 3600000,
        maxActionsPerSession: 500,
        permitTtlMs: 15000,
        maxDownloadRetries: 1,
        maxConsecutiveFailures: 3,
      },
    };
    const appConfig = {
      mode: 'execute' as const,
      releasePhase: 'C' as const,
      executionEnabled: true,
      maxConcurrentJobs: 1,
      maxSubmissionsPerRun: 5,
      maxRequestedOutputsPerRun: 10,
      maxReadRetries: 1,
      stopOnUnknownState: true,
      allowAutomaticResubmission: false as const,
      allowAccountChanges: false as const,
      allowPurchases: false as const,
      allowDeletion: false as const,
      allowRawTraces: false,
      dryRunMutatesPage: false as const,
      runtimeDir: tmpDir,
    };

    const budgetGuard = new BudgetGuard(db, policyConfig);
    const ledger = new SubmissionLedger(db, eventRepo, budgetGuard);
    const permitStore = new PermitStore(db, eventRepo);
    const policyEngine = new PolicyEngine(appConfig, policyConfig);
    const safetyGateway = new DefaultSafetyGateway({
      policyEngine,
      permitStore,
      eventRepo,
      lookupTransition: () => ({
        transitionStatus: 'validated',
        controlStatus: 'validated',
        observedMatches: 1,
        approvedForModes: ['prepare', 'execute'],
      }),
      permitTtlMs: 15000,
    });

    const artifactStore = new ArtifactStore({
      flowDb: db,
      eventRepo,
      artifactsBaseDir: path.join(tmpDir, 'artifacts'),
      stagingBaseDir: path.join(tmpDir, 'staging'),
    });
    const verifier = new DownloadVerifier({ artifactStore });
    const localReconciler = new LocalArtifactReconciler(artifactStore);

    const state = {
      model: 'veo-2',
      aspectRatio: '16:9',
      outputs: 1,
      promptText: '',
      promptDigest: sha256Hex(''),
      submitClicks: 0,
      submitted: false,
    };

    const reader: FlowReader = {
      inspectContext: async () => ({
        controllerEpoch: 1,
        sessionEpoch: 1,
        pageId: 'p1',
        url: 'https://labs.google/fx/pt/tools/flow/project/proj_1',
        locale: 'pt-BR',
        viewport: { width: 1440, height: 900 },
        accountContextId: 'acc_1',
        projectContextId: 'proj_1',
        creationMode: 'TEXT_TO_VIDEO',
        observedVariant: 'v1',
        observedRevision: 1,
        isAuthenticated: true,
        hasCaptchaOrVerification: false,
        humanInterferenceDetected: false,
      }),
      inspectCreationForm: async () => ({
        selectedModel: state.model,
        selectedAspectRatio: state.aspectRatio,
        selectedOutputsCount: state.outputs,
        promptText: state.promptText,
        promptDigestSha256: state.promptDigest,
        uploadReadyFilename: null,
        observedConfigDigest: computeObservedConfigDigest({
          projectContextId: 'proj_1',
          model: state.model,
          aspectRatio: state.aspectRatio,
          requestedOutputs: state.outputs,
          promptDigestSha256: state.promptDigest,
        }),
        observedRevision: 1,
      }),
      inspectResults: async () => {
        if (!state.submitted) return { isVirtualizedOrPartial: false, items: [] };
        if (mode === 'PARTIAL_2_OF_3') {
          return {
            isVirtualizedOrPartial: false,
            items: [
              {
                remoteExternalId: 'rem_partial_job',
                remoteAssetId: 'asset_0',
                resultIndex: 0,
                status: 'READY',
                promptSnippetDigest: state.promptDigest,
                createdAtLabel: 'Just now',
                downloadControlId: 'ctrl_download_0',
              },
              {
                remoteExternalId: 'rem_partial_job',
                remoteAssetId: 'asset_1',
                resultIndex: 1,
                status: 'READY',
                promptSnippetDigest: state.promptDigest,
                createdAtLabel: 'Just now',
                downloadControlId: 'ctrl_download_1',
              },
              {
                remoteExternalId: 'rem_partial_job',
                remoteAssetId: 'asset_2',
                resultIndex: 2,
                status: 'FAILED_REMOTE',
                promptSnippetDigest: state.promptDigest,
                createdAtLabel: 'Just now',
                downloadControlId: null,
              },
            ],
          };
        }
        return { isVirtualizedOrPartial: false, items: [] };
      },
    };

    const executor: AuthorizedExecutor = {
      execute: async (permitId: string): Promise<ActionOutcome> => {
        const { permit, plan } = permitStore.getPermitAndPlan(permitId);
        if (permit.targetControlId === 'ctrl_model_selector') {
          state.model = String(plan.paramsCanonical.model);
          state.submitted = false;
        } else if (permit.targetControlId === 'ctrl_aspect_and_outputs') {
          state.aspectRatio = String(plan.paramsCanonical.aspectRatio);
          state.outputs = Number(plan.paramsCanonical.requestedOutputs);
        } else if (permit.targetControlId === 'ctrl_prompt_textarea') {
          state.promptText = String(plan.paramsCanonical.promptText);
          state.promptDigest = String(plan.paramsCanonical.promptDigestSha256);
        } else if (permit.actionKind === 'SUBMIT') {
          state.submitClicks += 1;
          if (mode === 'TIMEOUT_ON_JOB_1') {
            throw new Error('Timeout apos clique de submissao do Job 1');
          }
          state.submitted = true;
        }
        return {
          permitId,
          planId: plan.planId,
          actionKind: permit.actionKind,
          status: 'SUCCESS',
          observedRevisionAfter: 1,
          postconditionVerified: true,
          details: {},
        };
      },
    };

    const planner = new DefaultActionPlanner();
    const executionService = new ExecutionService({
      reader,
      planner,
      safetyGateway,
      executor,
      ledger,
      reconciler: new RemoteReconciler(),
      registryVersion: 'reg_1',
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
      reader,
      planner,
      safetyGateway,
      executor,
      downloadProvider: async () => ({ suggestedFilename: 'video.mp4', bytes: makeMp4() }),
      registryVersion: 'reg_1',
      policyVersion: '1.0.0',
    });
    const circuitBreaker = new CircuitBreaker({
      flowDb: db,
      eventRepo,
      maxConsecutiveFailures: 3,
    });
    const orchestrator = new JobOrchestrator({
      flowDb: db,
      ledger,
      executionService,
      recoveryService,
      circuitBreaker,
      stopController: new StopController(permitStore),
    });

    return { db, ledger, orchestrator, circuitBreaker, state };
  }

  it('para imediatamente o lote quando o Job #1 entra em UNKNOWN, deixando Jobs #2 e #3 intocados em QUEUED', async () => {
    const h = buildChaosHarness('TIMEOUT_ON_JOB_1');
    try {
      const jobs = [1, 2, 3].map((n) =>
        h.ledger.createJob({
          prompt: `Job ${n}`,
          model: 'veo-2',
          aspectRatio: '16:9',
          requestedOutputs: 1,
          projectContextId: 'proj_1',
          accountContextId: 'acc_1',
          completionPolicy: {
            minVerifiedOutputs: 1,
            allowPartial: false,
            technicalRequirements: { minSizeBytes: 1024, expectedContainer: 'mp4' },
          },
        })
      );

      const summary = await h.orchestrator.runSerialBatch(
        jobs.map((j) => j.jobId),
        1
      );

      expect(summary.processedJobIds).toEqual([jobs[0]!.jobId]);
      expect(summary.haltedJobId).toBe(jobs[0]!.jobId);
      expect(h.state.submitClicks).toBe(1);
      expect(h.circuitBreaker.getState().status).toBe('OPEN');

      // Jobs 2 e 3 permanecem intocados em QUEUED
      expect(h.ledger.getJobById(jobs[1]!.jobId).status).toBe('QUEUED');
      expect(h.ledger.getJobById(jobs[2]!.jobId).status).toBe('QUEUED');
    } finally {
      h.db.close();
    }
  });

  it('fecha Job com requestedOutputs=3 (2 VERIFIED + 1 FAILED_REMOTE) em PARTIAL e nunca em COMPLETED (BC-10, BC-11)', async () => {
    const h = buildChaosHarness('PARTIAL_2_OF_3');
    try {
      const job = h.ledger.createJob({
        prompt: 'Job com 3 saidas solicitadas e 1 falha remota',
        model: 'veo-2',
        aspectRatio: '16:9',
        requestedOutputs: 3,
        projectContextId: 'proj_1',
        accountContextId: 'acc_1',
        completionPolicy: {
          minVerifiedOutputs: 2,
          allowPartial: true,
          technicalRequirements: { minSizeBytes: 1024, expectedContainer: 'mp4' },
        },
      });

      const summary = await h.orchestrator.runSerialBatch([job.jobId], 1);
      expect(summary.completedJobIds).toHaveLength(0);
      expect(summary.partialJobIds).toEqual([job.jobId]);

      const finalJob = h.ledger.getJobById(job.jobId);
      expect(finalJob.status).toBe('PARTIAL');
      expect(finalJob.phase).toBe('DONE');
    } finally {
      h.db.close();
    }
  });
});
