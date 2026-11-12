import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SubmissionLedger } from '../../src/execution/submission-ledger.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { BudgetGuard } from '../../src/safety/budget-guard.js';
import type { PolicyConfig } from '../../src/shared/config-schema.js';
import { PolicyDeniedError } from '../../src/shared/errors.js';

const policyB: PolicyConfig = {
  policyVersion: '1.0.0',
  releasePhase: 'B',
  allowedWorkOrigins: ['https://labs.google'],
  allowedLoginOrigins: ['https://accounts.google.com'],
  authorizedProjects: ['proj_1'],
  authorizedAccounts: ['acct_1'],
  limits: {
    maxSubmissionsPerRun: 1,
    maxSubmissionsPerWindow: 2,
    windowDurationMs: 3600000,
    maxRequestedOutputsPerRun: 2,
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

describe('Gate G7 — Security: Budget Survival Across Restarts & No Automatic Resubmission (BC-01, BC-07, BC-09)', () => {
  it('mantem reserva bloqueada em UNKNOWN apos reiniciar o processo e impede reenvio do mesmo job', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g7-sec-'));
    const dbPath = path.join(tmpDir, 'ledger.db');

    // Processo #1
    const db1 = new FlowDatabase(dbPath);
    const redactor = new Redactor();
    const repo1 = new EventRepository(db1, redactor);
    const guard1 = new BudgetGuard(db1, policyB);
    const ledger1 = new SubmissionLedger(db1, repo1, guard1);

    let job1Id = '';
    try {
      const job1 = ledger1.createJob({
        prompt: 'Cena 1 da tempestade',
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
      job1Id = job1.jobId;

      const { intent } = ledger1.createIntentAndReserveBudget({
        jobId: job1.jobId,
        controllerEpoch: 1,
        observedConfigDigest: sha256Hex('cfg'),
        baselineSnapshot: { items: [] },
        policyVersion: '1.0.0',
        registryVersion: 'reg_1',
      });

      // Tentar criar segunda intencao para o mesmo job -> bloqueado (BC-07)
      expect(() =>
        ledger1.createIntentAndReserveBudget({
          jobId: job1.jobId,
          controllerEpoch: 1,
          observedConfigDigest: sha256Hex('cfg'),
          baselineSnapshot: { items: [] },
          policyVersion: '1.0.0',
          registryVersion: 'reg_1',
        })
      ).toThrow(/Proibido criar reenvio automatico/);

      ledger1.markDispatchingBeforeClick(intent.submissionIntentId);
      // Simular falha pos-clique -> UNKNOWN (mantem reserva HELD_UNKNOWN)
      ledger1.markUnknownOnPostDispatchFailure({
        submissionIntentId: intent.submissionIntentId,
        reason: 'Timeout apos clique',
        controllerEpoch: 1,
        policyVersion: '1.0.0',
        registryVersion: 'reg_1',
      });
    } finally {
      db1.close();
    }

    // Processo #2 (Simula restart completo abrindo o mesmo arquivo SQLite)
    const db2 = new FlowDatabase(dbPath);
    const repo2 = new EventRepository(db2, redactor);
    const guard2 = new BudgetGuard(db2, policyB);
    const ledger2 = new SubmissionLedger(db2, repo2, guard2);

    try {
      const job2 = ledger2.createJob({
        prompt: 'Cena 1 da tempestade', // Mesmo texto de prompt, mas UUID distinto (BC-01)!
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
      expect(job2.jobId).not.toBe(job1Id);

      // Como o job1 deixou 1 reserva em HELD_UNKNOWN e maxSubmissionsPerRun=1,
      // o novo processo DEVE bloquear nova reserva ate que o UNKNOWN seja reconciliado (BC-09)!
      expect(() =>
        ledger2.createIntentAndReserveBudget({
          jobId: job2.jobId,
          controllerEpoch: 2,
          observedConfigDigest: sha256Hex('cfg'),
          baselineSnapshot: { items: [] },
          policyVersion: '1.0.0',
          registryVersion: 'reg_1',
        })
      ).toThrow(PolicyDeniedError);
    } finally {
      db2.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
