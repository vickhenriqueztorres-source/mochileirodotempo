import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecutionService } from '../../src/application/execution-service.js';
import { RecoveryService } from '../../src/application/recovery-service.js';
import { JobOrchestrator } from '../../src/execution/job-orchestrator.js';
import { RemoteReconciler } from '../../src/execution/remote-reconciler.js';
import { SubmissionLedger } from '../../src/execution/submission-ledger.js';
import { DefaultActionPlanner } from '../../src/flow/action-planner.js';
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

describe('Gate G10 — Unit: Persistent CircuitBreaker & Safe Local Job Cancellation (BC-17, BC-18)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('abre CircuitBreaker apos falhas consecutivas e mantem estado OPEN apos reiniciar o processo ate reset explicito', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g10-cb-'));
    tempDirs.push(tmpDir);
    const dbPath = path.join(tmpDir, 'cb.sqlite');

    // Processo 1: registra 3 falhas consecutivas -> abre CircuitBreaker
    const db1 = new FlowDatabase(dbPath);
    const repo1 = new EventRepository(db1, new Redactor());
    const cb1 = new CircuitBreaker({
      flowDb: db1,
      eventRepo: repo1,
      maxConsecutiveFailures: 3,
    });

    try {
      expect(cb1.getState().status).toBe('CLOSED');
      cb1.recordFailure({ reason: 'Falha 1', controllerEpoch: 1 });
      cb1.recordFailure({ reason: 'Falha 2', controllerEpoch: 1 });
      expect(cb1.getState().status).toBe('CLOSED');

      const s3 = cb1.recordFailure({ reason: 'Falha 3', controllerEpoch: 1 });
      expect(s3.status).toBe('OPEN');
      expect(s3.consecutiveFailures).toBe(3);
      expect(() => cb1.assertClosedOrThrow()).toThrow(PolicyDeniedError);
    } finally {
      db1.close();
    }

    // Processo 2: reabre o banco -> CircuitBreaker continua OPEN!
    const db2 = new FlowDatabase(dbPath);
    const repo2 = new EventRepository(db2, new Redactor());
    const cb2 = new CircuitBreaker({
      flowDb: db2,
      eventRepo: repo2,
      maxConsecutiveFailures: 3,
    });

    try {
      expect(cb2.getState().status).toBe('OPEN');
      expect(() => cb2.assertClosedOrThrow()).toThrow(PolicyDeniedError);

      // Reset explicito do operador fecha o CircuitBreaker
      const afterReset = cb2.resetByOperator('Mapa revalidado e jobs reconciliados', 2);
      expect(afterReset.status).toBe('CLOSED');
      expect(afterReset.consecutiveFailures).toBe(0);
    } finally {
      db2.close();
    }
  });

  it('cancelJobLocally marca Job como CANCELLED_LOCAL mas preserva SubmissionIntent e BudgetReservation se ja houve disparo (BC-17)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g10-cancel-'));
    tempDirs.push(tmpDir);

    const db = new FlowDatabase(path.join(tmpDir, 'state.sqlite'));
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
        maxActionsPerSession: 200,
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
        approvedForModes: ['execute'],
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
    const planner = new DefaultActionPlanner();
    const dummyReader = {
      inspectContext: async () => {
        throw new Error('not called');
      },
      inspectCreationForm: async () => {
        throw new Error('not called');
      },
      inspectResults: async () => ({ isVirtualizedOrPartial: false, items: [] }),
    };
    const dummyExecutor = {
      execute: async () => {
        throw new Error('not called');
      },
    };

    const execService = new ExecutionService({
      reader: dummyReader,
      planner,
      safetyGateway,
      executor: dummyExecutor,
      ledger,
      reconciler: new RemoteReconciler(),
      registryVersion: 'reg_1',
      policyVersion: '1.0.0',
      mode: 'execute',
    });
    const recService = new RecoveryService({
      flowDb: db,
      ledger,
      permitStore,
      artifactStore,
      verifier,
      localReconciler,
      reader: dummyReader,
      planner,
      safetyGateway,
      executor: dummyExecutor,
      downloadProvider: async () => ({ suggestedFilename: 'a.mp4', bytes: Buffer.alloc(0) }),
      registryVersion: 'reg_1',
      policyVersion: '1.0.0',
    });
    const cb = new CircuitBreaker({ flowDb: db, eventRepo, maxConsecutiveFailures: 3 });
    const orchestrator = new JobOrchestrator({
      flowDb: db,
      ledger,
      executionService: execService,
      recoveryService: recService,
      circuitBreaker: cb,
      stopController: new StopController(permitStore),
    });

    try {
      const job = ledger.createJob({
        prompt: 'Cancel test after dispatch',
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
      });

      const { intent } = ledger.createIntentAndReserveBudget({
        jobId: job.jobId,
        controllerEpoch: 1,
        observedConfigDigest: sha256Hex('cfg'),
        baselineSnapshot: {},
        policyVersion: '1.0.0',
        registryVersion: 'reg_1',
      });
      ledger.markDispatchingBeforeClick(intent.submissionIntentId);
      ledger.markUnknownOnPostDispatchFailure({
        submissionIntentId: intent.submissionIntentId,
        reason: 'Timeout pos-clique',
        controllerEpoch: 1,
        policyVersion: '1.0.0',
        registryVersion: 'reg_1',
      });

      // Cancelar localmente o Job enquanto a intencao esta em UNKNOWN
      const cancelled = orchestrator.cancelJobLocally(job.jobId);
      expect(cancelled.status).toBe('CANCELLED_LOCAL');

      // A SubmissionIntent e a BudgetReservation DEVEM continuar preservadas em UNKNOWN / HELD_UNKNOWN (BC-17)!
      const intentAfter = ledger.getIntentById(intent.submissionIntentId);
      expect(intentAfter.status).toBe('UNKNOWN');

      const resAfter = budgetGuard.getReservationByIntent(intent.submissionIntentId);
      expect(resAfter?.status).toBe('HELD_UNKNOWN');
    } finally {
      db.close();
    }
  });
});
