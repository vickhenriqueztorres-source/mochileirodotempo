import { describe, expect, it } from 'vitest';
import { SubmissionLedger } from '../../src/execution/submission-ledger.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { BudgetGuard } from '../../src/safety/budget-guard.js';
import type { PolicyConfig } from '../../src/shared/config-schema.js';
import { PersistenceFailureError } from '../../src/shared/errors.js';

const policyB: PolicyConfig = {
  policyVersion: '1.0.0',
  releasePhase: 'B',
  allowedWorkOrigins: ['https://labs.google'],
  allowedLoginOrigins: ['https://accounts.google.com'],
  authorizedProjects: ['proj_1'],
  authorizedAccounts: ['acct_1'],
  limits: {
    maxSubmissionsPerRun: 5,
    maxSubmissionsPerWindow: 10,
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

describe('Gate G7 — Chaos: Crash & Fault Injection at Every Submission Boundary (§13, §23, BC-05, BC-07)', () => {
  it('Fronteira 1: falha de banco antes de persistir RESERVED garante zero cliques e zero intencoes gravadas (BC-05)', () => {
    const flowDb = new FlowDatabase(':memory:');
    const eventRepo = new EventRepository(flowDb, new Redactor());
    const guard = new BudgetGuard(flowDb, policyB);
    const ledger = new SubmissionLedger(flowDb, eventRepo, guard);

    try {
      const job = ledger.createJob({
        prompt: 'Boundary 1',
        model: 'veo-2',
        aspectRatio: '16:9',
        requestedOutputs: 1,
        projectContextId: 'proj_1',
        accountContextId: 'acct_1',
        completionPolicy: {
          minVerifiedOutputs: 1,
          allowPartial: false,
          technicalRequirements: { minSizeBytes: 1024, expectedContainer: 'mp4' },
        },
      });

      flowDb.injectFaultForTesting('DISK_FULL');
      let clicksExecuted = 0;

      expect(() => {
        ledger.createIntentAndReserveBudget({
          jobId: job.jobId,
          controllerEpoch: 1,
          observedConfigDigest: sha256Hex('cfg'),
          baselineSnapshot: {},
          policyVersion: '1.0.0',
          registryVersion: 'reg_1',
        });
        clicksExecuted += 1;
      }).toThrow(PersistenceFailureError);

      expect(clicksExecuted).toBe(0);
      expect(ledger.getIntentByJobId(job.jobId)).toBeNull();
    } finally {
      flowDb.close();
    }
  });

  it('Fronteiras 2, 3 e 4: abort antes de DISPATCHING libera reserva; crash em DISPATCHING vira UNKNOWN no startup e preserva reserva', () => {
    const flowDb = new FlowDatabase(':memory:');
    const eventRepo = new EventRepository(flowDb, new Redactor());
    const guard = new BudgetGuard(flowDb, policyB);
    const ledger = new SubmissionLedger(flowDb, eventRepo, guard);

    try {
      // Fronteira 2: Abortar ainda em RESERVED (antes do clique)
      const jobAbort = ledger.createJob({
        prompt: 'Boundary 2',
        model: 'veo-2',
        aspectRatio: '16:9',
        requestedOutputs: 1,
        projectContextId: 'proj_1',
        accountContextId: 'acct_1',
        completionPolicy: {
          minVerifiedOutputs: 1,
          allowPartial: false,
          technicalRequirements: { minSizeBytes: 1024, expectedContainer: 'mp4' },
        },
      });
      const resAbort = ledger.createIntentAndReserveBudget({
        jobId: jobAbort.jobId,
        controllerEpoch: 1,
        observedConfigDigest: sha256Hex('cfg'),
        baselineSnapshot: {},
        policyVersion: '1.0.0',
        registryVersion: 'reg_1',
      });
      const aborted = ledger.abortBeforeDispatch(
        resAbort.intent.submissionIntentId,
        'Divergencia na releitura pre-clique',
        1
      );
      expect(aborted.status).toBe('ABORTED');
      expect(
        guard.getReservationByIntent(resAbort.intent.submissionIntentId)?.status
      ).toBe('RELEASED_ABORTED');

      // Fronteira 3: Crash exatamente apos gravar DISPATCHING (durante o clique)
      const jobCrash = ledger.createJob({
        prompt: 'Boundary 3',
        model: 'veo-2',
        aspectRatio: '16:9',
        requestedOutputs: 1,
        projectContextId: 'proj_1',
        accountContextId: 'acct_1',
        completionPolicy: {
          minVerifiedOutputs: 1,
          allowPartial: false,
          technicalRequirements: { minSizeBytes: 1024, expectedContainer: 'mp4' },
        },
      });
      const resCrash = ledger.createIntentAndReserveBudget({
        jobId: jobCrash.jobId,
        controllerEpoch: 1,
        observedConfigDigest: sha256Hex('cfg'),
        baselineSnapshot: {},
        policyVersion: '1.0.0',
        registryVersion: 'reg_1',
      });
      ledger.markDispatchingBeforeClick(resCrash.intent.submissionIntentId);

      // Simular reinicio do processo encontrando a intencao em DISPATCHING
      const recovered = ledger.recoverInFlightIntentsOnStartup(2);
      expect(recovered).toHaveLength(1);
      expect(recovered[0]?.status).toBe('UNKNOWN');

      // A reserva de orcamento DEVE ter sido mantida como HELD_UNKNOWN e o Job pausado em UNKNOWN_STATE!
      expect(
        guard.getReservationByIntent(resCrash.intent.submissionIntentId)?.status
      ).toBe('HELD_UNKNOWN');
      const updatedJob = ledger.getJobById(jobCrash.jobId);
      expect(updatedJob.status).toBe('PAUSED');
      expect(updatedJob.pauseReason).toBe('UNKNOWN_STATE');
    } finally {
      flowDb.close();
    }
  });
});
