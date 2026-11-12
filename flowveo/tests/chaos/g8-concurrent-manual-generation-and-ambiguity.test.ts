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
  ResultObservation,
} from '../../src/flow/contracts.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { BudgetGuard } from '../../src/safety/budget-guard.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import { PolicyEngine } from '../../src/safety/policy-engine.js';
import { DefaultSafetyGateway } from '../../src/safety/safety-gateway.js';
import type { PolicyConfig } from '../../src/shared/config-schema.js';

describe('Gate G8 — Chaos: Concurrent Manual Generation Ambiguity & Post-Submit Timeout (BC-07, BC-08)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  function createHarness(scenario: 'CONCURRENT_IDENTICAL_CARDS' | 'POST_CLICK_TIMEOUT') {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g8-chaos-'));
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

    const promptText = 'Prompt em conflito com geracao manual concorrente';
    const promptDigest = sha256Hex(promptText);
    const expectedDigest = computeObservedConfigDigest({
      projectContextId: 'proj_1',
      model: 'veo-2',
      aspectRatio: '16:9',
      requestedOutputs: 2,
      promptDigestSha256: promptDigest,
    });

    let submitClicks = 0;

    const reader: FlowReader = {
      inspectContext: async (): Promise<ContextSnapshot> => ({
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
        observedRevision: 5,
        isAuthenticated: true,
        hasCaptchaOrVerification: false,
        humanInterferenceDetected: false,
      }),
      inspectCreationForm: async (): Promise<CreationSnapshot> => ({
        selectedModel: 'veo-2',
        selectedAspectRatio: '16:9',
        selectedOutputsCount: 2,
        promptText,
        promptDigestSha256: promptDigest,
        uploadReadyFilename: null,
        observedConfigDigest: expectedDigest,
        observedRevision: 5,
      }),
      inspectResults: async (): Promise<{
        isVirtualizedOrPartial: boolean;
        items: ResultObservation[];
      }> => {
        if (submitClicks === 0) {
          return { isVirtualizedOrPartial: false, items: [] };
        }
        return {
          isVirtualizedOrPartial: false,
          items: [
            {
              remoteExternalId: 'rgen_auto_or_manual_A',
              remoteAssetId: 'asset_A',
              resultIndex: 0,
              status: 'PROCESSING',
              promptSnippetDigest: promptDigest,
              createdAtLabel: 'Just now',
              downloadControlId: null,
            },
            {
              remoteExternalId: 'rgen_auto_or_manual_B',
              remoteAssetId: 'asset_B',
              resultIndex: 1,
              status: 'PROCESSING',
              promptSnippetDigest: promptDigest,
              createdAtLabel: 'Just now',
              downloadControlId: null,
            },
          ],
        };
      },
    };

    const executor: AuthorizedExecutor = {
      execute: async (permitId: string): Promise<ActionOutcome> => {
        submitClicks += 1;
        if (scenario === 'POST_CLICK_TIMEOUT') {
          throw new Error('Timeout de rede aguardando resposta do clique de geracao');
        }
        return {
          permitId,
          planId: 'plan_1',
          actionKind: 'SUBMIT',
          status: 'SUCCESS',
          observedRevisionAfter: 6,
          postconditionVerified: true,
          details: {},
        };
      },
    };

    const service = new ExecutionService({
      reader,
      planner: new DefaultActionPlanner(),
      safetyGateway,
      executor,
      ledger,
      reconciler: new RemoteReconciler(),
      registryVersion: 'reg_1',
      policyVersion: '1.0.0',
      mode: 'execute',
    });

    return { db, ledger, budgetGuard, service, promptText, getSubmitClicks: () => submitClicks };
  }

  it('classifica como AMBIGUOUS e pausa o Job em NEEDS_REVIEW quando surgem 2 resultados identicos concorrentes (BC-08)', async () => {
    const h = createHarness('CONCURRENT_IDENTICAL_CARDS');
    try {
      const job = h.ledger.createJob({
        prompt: h.promptText,
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

      const res = await h.service.executeSingleSubmission(job.jobId);
      expect(res.outcomeStatus).toBe('UNKNOWN_AMBIGUOUS');
      expect(res.correlationDecision?.status).toBe('AMBIGUOUS');
      expect(res.job.status).toBe('NEEDS_REVIEW');
      expect(h.getSubmitClicks()).toBe(1);
    } finally {
      h.db.close();
    }
  });

  it('registra submission.unknown, mantem reserva HELD_UNKNOWN e faz ZERO novos cliques em timeout apos o envio (BC-07)', async () => {
    const h = createHarness('POST_CLICK_TIMEOUT');
    try {
      const job = h.ledger.createJob({
        prompt: h.promptText,
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

      const res = await h.service.executeSingleSubmission(job.jobId);
      expect(res.outcomeStatus).toBe('UNKNOWN_ERROR');
      expect(h.getSubmitClicks()).toBe(1);

      const intent = h.ledger.getIntentById(res.submissionIntentId);
      expect(intent.status).toBe('UNKNOWN');

      const budget = h.budgetGuard.getReservationByIntent(res.submissionIntentId);
      expect(budget?.status).toBe('HELD_UNKNOWN');
    } finally {
      h.db.close();
    }
  });
});
