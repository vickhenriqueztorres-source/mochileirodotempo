import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecutionService } from '../../src/application/execution-service.js';
import type { ActionOutcome } from '../../src/domain/actions/action-types.js';
import { RemoteReconciler } from '../../src/execution/remote-reconciler.js';
import { SubmissionLedger } from '../../src/execution/submission-ledger.js';
import { DefaultActionPlanner, computeObservedConfigDigest } from '../../src/flow/action-planner.js';
import type {
  AuthorizedExecutor,
  ContextSnapshot,
  CreationSnapshot,
  FlowReader,
} from '../../src/flow/contracts.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { BudgetGuard } from '../../src/safety/budget-guard.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import { PolicyEngine } from '../../src/safety/policy-engine.js';
import { DefaultSafetyGateway } from '../../src/safety/safety-gateway.js';
import type { PolicyConfig } from '../../src/shared/config-schema.js';
import { PermitInvalidError } from '../../src/shared/errors.js';

describe('Gate G8 — Security: Dry-Run Zero Mutation, Composite Prepare & Pre-Submit Revalidation (BC-02, BC-03, BC-04, S-03)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  function setupTestEnv(driftBeforeSubmitClick = false) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g8-sec-'));
    tempDirs.push(tmpDir);

    const db = new FlowDatabase(path.join(tmpDir, 'state.sqlite'));
    const redactor = new Redactor();
    const eventRepo = new EventRepository(db, redactor);
    const policyConfig: PolicyConfig = {
      policyVersion: '1.0.0',
      releasePhase: 'B',
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
        maxActionsPerSession: 200,
        permitTtlMs: 15000,
        maxDownloadRetries: 2,
        maxConsecutiveFailures: 3,
      },
    };

    const appConfig = {
      mode: 'execute' as const,
      releasePhase: 'B' as const,
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

    const promptText = 'Cinematic POV flood scene in ancient city';
    const promptDigest = sha256Hex(promptText);

    const state = {
      projectContextId: 'proj_1',
      selectedModel: 'default-model',
      selectedAspectRatio: '16:9',
      selectedOutputsCount: 1,
      promptText: '',
      promptDigestSha256: sha256Hex(''),
      observedRevision: 1,
      executorCalls: [] as string[],
      submitInspectCount: 0,
    };

    const computeCurrentDigest = () =>
      computeObservedConfigDigest({
        projectContextId: state.projectContextId,
        model: state.selectedModel,
        aspectRatio: state.selectedAspectRatio,
        requestedOutputs: state.selectedOutputsCount,
        promptDigestSha256: state.promptDigestSha256,
      });

    const reader: FlowReader = {
      inspectContext: async (): Promise<ContextSnapshot> => ({
        controllerEpoch: 1,
        sessionEpoch: 1,
        pageId: 'page_1',
        url: 'https://labs.google/fx/pt/tools/flow/project/proj_1',
        locale: 'pt-BR',
        viewport: { width: 1440, height: 900 },
        accountContextId: 'acc_1',
        projectContextId: state.projectContextId,
        creationMode: 'TEXT_TO_VIDEO',
        observedVariant: 'v1',
        observedRevision: state.observedRevision,
        isAuthenticated: true,
        hasCaptchaOrVerification: false,
        humanInterferenceDetected: false,
      }),
      inspectCreationForm: async (): Promise<CreationSnapshot> => {
        if (driftBeforeSubmitClick && state.executorCalls.length === 3) {
          state.submitInspectCount += 1;
          if (state.submitInspectCount >= 3) {
            state.selectedModel = 'wrong-unintended-model';
          }
        }
        return {
          selectedModel: state.selectedModel,
          selectedAspectRatio: state.selectedAspectRatio,
          selectedOutputsCount: state.selectedOutputsCount,
          promptText: state.promptText,
          promptDigestSha256: state.promptDigestSha256,
          uploadReadyFilename: null,
          observedConfigDigest: computeCurrentDigest(),
          observedRevision: state.observedRevision,
        };
      },
      inspectResults: async () => ({
        isVirtualizedOrPartial: false,
        items: [],
      }),
    };

    const executor: AuthorizedExecutor = {
      execute: async (permitId: string): Promise<ActionOutcome> => {
        const { permit } = permitStore.getPermitAndPlan(permitId);
        state.executorCalls.push(permit.actionKind);
        if (permit.targetControlId === 'ctrl_model_selector') {
          state.selectedModel = 'veo-2';
        } else if (permit.targetControlId === 'ctrl_aspect_and_outputs') {
          state.selectedAspectRatio = '16:9';
          state.selectedOutputsCount = 2;
        } else if (permit.targetControlId === 'ctrl_prompt_textarea') {
          state.promptText = promptText;
          state.promptDigestSha256 = promptDigest;
        }
        return {
          permitId,
          planId: permit.planId,
          actionKind: permit.actionKind,
          status: 'SUCCESS',
          observedRevisionAfter: state.observedRevision,
          postconditionVerified: true,
          details: {},
        };
      },
    };

    return {
      db,
      ledger,
      budgetGuard,
      state,
      promptText,
      Service: new ExecutionService({
        reader,
        planner: new DefaultActionPlanner(),
        safetyGateway,
        executor,
        ledger,
        reconciler: new RemoteReconciler(),
        registryVersion: 'reg_1',
        policyVersion: '1.0.0',
        mode: 'execute',
      }),
    };
  }

  it('dryRunJob gera todos os planos da preparacao + submissao com ZERO mutacoes na pagina (BC-02)', async () => {
    const env = setupTestEnv(false);
    try {
      const job = env.ledger.createJob({
        prompt: env.promptText,
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

      const dryRun = await env.Service.dryRunJob(job.jobId);
      expect(dryRun.mutationsExecuted).toBe(0);
      expect(dryRun.plannedSteps).toHaveLength(4);
      expect(env.state.executorCalls).toHaveLength(0);
    } finally {
      env.db.close();
    }
  });

  it('detecta mudanca de modelo milissegundos antes de SUBMIT, aborta antes de DISPATCHING e faz 0 cliques de envio (BC-04 / S-03)', async () => {
    const env = setupTestEnv(true);
    try {
      const job = env.ledger.createJob({
        prompt: env.promptText,
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

      const prep = await env.Service.prepareJob(job.jobId);
      expect(prep.executedOutcomes).toHaveLength(3);
      expect(env.state.executorCalls).toEqual(['CONFIGURE', 'CONFIGURE', 'FILL']);

      await expect(env.Service.executeSingleSubmission(job.jobId)).rejects.toThrow(
        PermitInvalidError
      );

      // Nenhum clique de SUBMIT ocorreu!
      expect(env.state.executorCalls).toEqual(['CONFIGURE', 'CONFIGURE', 'FILL']);

      // Como abortou ANTES de DISPATCHING, a intencao foi para ABORTED e a reserva foi liberada (RELEASED_ABORTED)
      const intent = env.ledger.getIntentByJobId(job.jobId);
      expect(intent?.status).toBe('ABORTED');
      const res = env.budgetGuard.getReservationByIntent(intent!.submissionIntentId);
      expect(res?.status).toBe('RELEASED_ABORTED');
    } finally {
      env.db.close();
    }
  });
});
