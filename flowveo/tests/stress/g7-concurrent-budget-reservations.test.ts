import { describe, expect, it } from 'vitest';
import { SubmissionLedger } from '../../src/execution/submission-ledger.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { BudgetGuard } from '../../src/safety/budget-guard.js';
import type { PolicyConfig } from '../../src/shared/config-schema.js';

const policyCap3: PolicyConfig = {
  policyVersion: '1.0.0',
  releasePhase: 'B',
  allowedWorkOrigins: ['https://labs.google'],
  allowedLoginOrigins: ['https://accounts.google.com'],
  authorizedProjects: ['proj_1'],
  authorizedAccounts: ['acct_1'],
  limits: {
    maxSubmissionsPerRun: 3,
    maxSubmissionsPerWindow: 3,
    windowDurationMs: 3600000,
    maxRequestedOutputsPerRun: 3,
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

describe('Gate G7 — Stress: 40 Concurrent Jobs Competing for a Budget Cap of 3 Submissions (S-05)', () => {
  it('aprova exatamente 3 reservas e bloqueia 37 quando o teto de submissoes e 3', async () => {
    const flowDb = new FlowDatabase(':memory:');
    const eventRepo = new EventRepository(flowDb, new Redactor());
    const guard = new BudgetGuard(flowDb, policyCap3);
    const ledger = new SubmissionLedger(flowDb, eventRepo, guard);

    try {
      const jobs = Array.from({ length: 40 }, (_, i) =>
        ledger.createJob({
          prompt: `Prompt stress #${i + 1}`,
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
        })
      );

      const reservations = await Promise.allSettled(
        jobs.map((j) =>
          Promise.resolve().then(() =>
            ledger.createIntentAndReserveBudget({
              jobId: j.jobId,
              controllerEpoch: 1,
              observedConfigDigest: sha256Hex('cfg'),
              baselineSnapshot: {},
              policyVersion: '1.0.0',
              registryVersion: 'reg_1',
            })
          )
        )
      );

      const approved = reservations.filter((r) => r.status === 'fulfilled');
      const denied = reservations.filter((r) => r.status === 'rejected');

      expect(approved).toHaveLength(3);
      expect(denied).toHaveLength(37);
    } finally {
      flowDb.close();
    }
  });
});
