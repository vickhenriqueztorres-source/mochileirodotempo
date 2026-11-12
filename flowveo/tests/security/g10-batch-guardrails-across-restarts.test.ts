import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecutionService } from '../../src/application/execution-service.js';
import { RecoveryService } from '../../src/application/recovery-service.js';
import { buildFlowCli } from '../../src/cli/index.js';
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
import { PolicyDeniedError } from '../../src/shared/errors.js';

function validMp4(): Buffer {
  const b = Buffer.alloc(2048, 0);
  b.writeUInt32BE(24, 0);
  b.write('ftypisom', 4, 'ascii');
  return b;
}

describe('Gate G10 — Security: Batch Guardrails Across Restarts & CLI Release A Locks (BC-09, BC-18, A-18)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('executa exatamente 2 jobs em um lote de 5 quando maxSubmissionsPerWindow=2 e mantem o 3o job bloqueado mesmo apos reiniciar o processo', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g10-sec-'));
    tempDirs.push(tmpDir);
    const dbPath = path.join(tmpDir, 'batch.sqlite');

    const policyConfig: PolicyConfig = {
      policyVersion: '1.0.0',
      releasePhase: 'C',
      allowedWorkOrigins: ['https://labs.google'],
      allowedLoginOrigins: ['https://accounts.google.com'],
      authorizedProjects: ['proj_1'],
      authorizedAccounts: ['acc_1'],
      limits: {
        maxSubmissionsPerRun: 2,
        maxSubmissionsPerWindow: 2,
        windowDurationMs: 3600000,
        maxRequestedOutputsPerRun: 4,
        maxActiveJobs: 1,
        minFreeDiskBytes: 524288000,
        maxDownloadBytesPerSession: 1073741824,
        maxSessionDurationMs: 3600000,
        maxActionsPerSession: 500,
        permitTtlMs: 15000,
        maxDownloadRetries: 2,
        maxConsecutiveFailures: 3,
      },
    };

    const appConfig = {
      mode: 'execute' as const,
      releasePhase: 'C' as const,
      executionEnabled: true,
      maxConcurrentJobs: 1,
      maxSubmissionsPerRun: 2,
      maxRequestedOutputsPerRun: 4,
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

    const createProcessRuntime = () => {
      const db = new FlowDatabase(dbPath);
      const eventRepo = new EventRepository(db, new Redactor());
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

      const uiState = {
        model: 'veo-2',
        aspectRatio: '16:9',
        outputs: 1,
        promptText: '',
        promptDigest: sha256Hex(''),
        submitSeq: 0,
        hasNewResult: false,
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
          selectedModel: uiState.model,
          selectedAspectRatio: uiState.aspectRatio,
          selectedOutputsCount: uiState.outputs,
          promptText: uiState.promptText,
          promptDigestSha256: uiState.promptDigest,
          uploadReadyFilename: null,
          observedConfigDigest: computeObservedConfigDigest({
            projectContextId: 'proj_1',
            model: uiState.model,
            aspectRatio: uiState.aspectRatio,
            requestedOutputs: uiState.outputs,
            promptDigestSha256: uiState.promptDigest,
          }),
          observedRevision: 1,
        }),
        inspectResults: async () => {
          if (!uiState.hasNewResult) {
            return { isVirtualizedOrPartial: false, items: [] };
          }
          return {
            isVirtualizedOrPartial: false,
            items: [
              {
                remoteExternalId: `rem_ext_${uiState.submitSeq}`,
                remoteAssetId: `asset_${uiState.submitSeq}`,
                resultIndex: 0,
                status: 'READY',
                promptSnippetDigest: uiState.promptDigest,
                createdAtLabel: 'Just now',
                downloadControlId: 'ctrl_download_0',
              },
            ],
          };
        },
      };

      const executor: AuthorizedExecutor = {
        execute: async (permitId: string): Promise<ActionOutcome> => {
          const { permit, plan } = permitStore.getPermitAndPlan(permitId);
          if (permit.targetControlId === 'ctrl_model_selector') {
            uiState.model = String(plan.paramsCanonical.model);
            uiState.hasNewResult = false;
          } else if (permit.targetControlId === 'ctrl_aspect_and_outputs') {
            uiState.aspectRatio = String(plan.paramsCanonical.aspectRatio);
            uiState.outputs = Number(plan.paramsCanonical.requestedOutputs);
          } else if (permit.targetControlId === 'ctrl_prompt_textarea') {
            uiState.promptText = String(plan.paramsCanonical.promptText);
            uiState.promptDigest = String(plan.paramsCanonical.promptDigestSha256);
          } else if (permit.actionKind === 'SUBMIT') {
            uiState.submitSeq += 1;
            uiState.hasNewResult = true;
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
        downloadProvider: async () => ({ suggestedFilename: 'v.mp4', bytes: validMp4() }),
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

      return { db, ledger, orchestrator };
    };

    let jobIds: string[] = [];

    // Processo 1: cria 5 jobs e roda o lote -> completa 2 e para no 3o por limite de run/janela!
    const rt1 = createProcessRuntime();
    try {
      jobIds = Array.from({ length: 5 }, (_, idx) =>
        rt1.ledger.createJob({
          prompt: `Prompt do lote #${idx + 1}`,
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
        }).jobId
      );

      const summary1 = await rt1.orchestrator.runSerialBatch(jobIds, 1);
      expect(summary1.completedJobIds).toEqual([jobIds[0], jobIds[1]]);
      expect(summary1.haltedJobId).toBe(jobIds[2]);
      expect(summary1.haltReason).toContain('Limite');
    } finally {
      rt1.db.close();
    }

    // Processo 2 (apos restart): tenta rodar os jobs restantes (3, 4, 5) -> bloqueado imediatamente pelo limite persistente na janela!
    const rt2 = createProcessRuntime();
    try {
      const summary2 = await rt2.orchestrator.runSerialBatch(jobIds.slice(2), 2);
      expect(summary2.completedJobIds).toHaveLength(0);
      expect(summary2.haltedJobId).toBe(jobIds[2]);
      expect(summary2.haltReason).toContain('Limite persistente por janela temporal atingido');
    } finally {
      rt2.db.close();
    }
  });

  it('CLI na Release A bloqueia enqueue, prepare e run sem --dry-run, mas permite observe e run --dry-run (A-18)', async () => {
    let dryRunCalled = false;
    const cliDry = buildFlowCli('A', {
      dryRun: async () => {
        dryRunCalled = true;
        return 'ok';
      },
    });

    await cliDry.parseAsync(['node', 'flow', 'run', 'job_123', '--dry-run']);
    expect(dryRunCalled).toBe(true);

    await expect(
      buildFlowCli('A').parseAsync(['node', 'flow', 'run', 'job_123'])
    ).rejects.toThrow(PolicyDeniedError);
    await expect(
      buildFlowCli('A').parseAsync(['node', 'flow', 'prepare', 'job_123'])
    ).rejects.toThrow(PolicyDeniedError);
  });
});
