import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SubmissionLedger } from '../../src/execution/submission-ledger.js';
import { DefaultActionPlanner } from '../../src/flow/action-planner.js';
import { ArtifactStore } from '../../src/infrastructure/artifacts/artifact-store.js';
import { DownloadVerifier } from '../../src/infrastructure/artifacts/download-verifier.js';
import { LocalArtifactReconciler } from '../../src/infrastructure/artifacts/local-reconciler.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { BudgetGuard } from '../../src/safety/budget-guard.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import type { PolicyConfig } from '../../src/shared/config-schema.js';

describe('Gate G9 — Stress: 200 Artifacts Verification & Local Reconciliation', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('verifica e reconcilia 200 artefatos e arquivos mistos (intactos, missing, orfaos e .part) com 100% de precisao', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g9-stress-'));
    tempDirs.push(tmpDir);

    const db = new FlowDatabase(path.join(tmpDir, 'state.sqlite'));
    const eventRepo = new EventRepository(db, new Redactor());
    const policyConfig: PolicyConfig = {
      policyVersion: '1.0.0',
      releasePhase: 'B',
      allowedWorkOrigins: ['https://labs.google'],
      allowedLoginOrigins: ['https://accounts.google.com'],
      authorizedProjects: ['proj_1'],
      authorizedAccounts: ['acc_1'],
      limits: {
        maxSubmissionsPerRun: 5,
        maxSubmissionsPerWindow: 5,
        windowDurationMs: 3600000,
        maxRequestedOutputsPerRun: 20,
        maxActiveJobs: 1,
        minFreeDiskBytes: 524288000,
        maxDownloadBytesPerSession: 1073741824,
        maxSessionDurationMs: 3600000,
        maxActionsPerSession: 2000,
        permitTtlMs: 15000,
        maxDownloadRetries: 2,
        maxConsecutiveFailures: 3,
      },
    };

    const budgetGuard = new BudgetGuard(db, policyConfig);
    const ledger = new SubmissionLedger(db, eventRepo, budgetGuard);
    const permitStore = new PermitStore(db, eventRepo);
    const artifactsBaseDir = path.join(tmpDir, 'artifacts');
    const stagingBaseDir = path.join(tmpDir, 'staging');
    const artifactStore = new ArtifactStore({
      flowDb: db,
      eventRepo,
      artifactsBaseDir,
      stagingBaseDir,
    });
    const verifier = new DownloadVerifier({ artifactStore });
    const reconciler = new LocalArtifactReconciler(artifactStore);
    const planner = new DefaultActionPlanner();

    try {
      const job = ledger.createJob({
        prompt: 'Stress 200 items',
        model: 'veo-2',
        aspectRatio: '16:9',
        requestedOutputs: 4,
        projectContextId: 'proj_1',
        accountContextId: 'acc_1',
        completionPolicy: {
          minVerifiedOutputs: 1,
          allowPartial: true,
          technicalRequirements: { minSizeBytes: 1024, expectedContainer: 'mp4' },
        },
      });

      const digest = sha256Hex('cfg');
      const { intent } = ledger.createIntentAndReserveBudget({
        jobId: job.jobId,
        controllerEpoch: 1,
        observedConfigDigest: digest,
        baselineSnapshot: {},
        policyVersion: '1.0.0',
        registryVersion: 'reg_1',
      });
      ledger.markDispatchingBeforeClick(intent.submissionIntentId);
      const { remoteSubmission } = ledger.confirmSubmission({
        submissionIntentId: intent.submissionIntentId,
        scopeId: 'proj_1',
        remoteExternalId: 'rem_stress',
        controllerEpoch: 1,
        policyVersion: '1.0.0',
        registryVersion: 'reg_1',
        ruleApplied: 'LEVEL_1',
      });

      const ctx = {
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
      };

      // Criar 100 artefatos verificados (dos quais 20 serao deletados do disco -> MISSING),
      // 50 arquivos orfaos e 50 arquivos .part em staging = 200 itens!
      for (let i = 0; i < 100; i++) {
        const rres = artifactStore.upsertRemoteResult({
          remoteSubmissionId: remoteSubmission.remoteSubmissionId,
          resultIndex: i,
          remoteAssetId: `asset_${i}`,
          status: 'READY',
        });

        const dlPlan = planner.plan(
          {
            mode: 'execute',
            actionKind: 'DOWNLOAD',
            targetControlId: 'ctrl_dl',
            transitionId: 'tr_dl',
            paramsCanonical: { i },
            jobId: job.jobId,
            registryVersion: 'reg_1',
            policyVersion: '1.0.0',
            observedConfigDigest: digest,
          },
          ctx
        );
        const permit = permitStore.issuePermit(dlPlan, {
          controllerEpoch: 1,
          sessionEpoch: 1,
          pageId: 'p1',
          ttlMs: 15000,
        });

        const planned = artifactStore.planArtifactDownload({
          jobId: job.jobId,
          submissionIntentId: intent.submissionIntentId,
          remoteSubmissionId: remoteSubmission.remoteSubmissionId,
          remoteResultId: rres.remoteResultId,
          downloadPermitId: permit.permitId,
          remoteSuggestedFilename: `item_${i}.mp4`,
        });

        const buf = Buffer.alloc(1500, i % 255);
        buf.writeUInt32BE(24, 0);
        buf.write('ftypisom', 4, 'ascii');
        artifactStore.writeStagingPart(planned.artifactId, buf);
        const dl = artifactStore.finalizeStagingToDownloaded(planned.artifactId);
        await verifier.verifyDownloadedArtifact(dl.artifactId, job.completionPolicy);

        if (i < 20) {
          fs.rmSync(dl.finalPath, { force: true });
        }
      }

      for (let i = 0; i < 50; i++) {
        fs.writeFileSync(
          path.join(artifactsBaseDir, job.jobId, `orphan_${i}.mp4`),
          Buffer.alloc(128, 1)
        );
        fs.writeFileSync(path.join(stagingBaseDir, `temp_${i}.part`), Buffer.alloc(64, 2));
      }

      const report = reconciler.reconcile();
      expect(report.verifiedIntactCount).toBe(80);
      expect(report.markedMissingArtifactIds).toHaveLength(20);
      expect(report.orphanFilesOnDisk).toHaveLength(50);
      expect(report.cleanedStagingPartFiles).toHaveLength(50);
    } finally {
      db.close();
    }
  });
});
