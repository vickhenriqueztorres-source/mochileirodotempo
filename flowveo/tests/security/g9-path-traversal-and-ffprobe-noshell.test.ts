import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SubmissionLedger } from '../../src/execution/submission-ledger.js';
import { DefaultActionPlanner } from '../../src/flow/action-planner.js';
import {
  ArtifactStore,
  sanitizeRemoteFilenameMetadata,
} from '../../src/infrastructure/artifacts/artifact-store.js';
import { DownloadVerifier } from '../../src/infrastructure/artifacts/download-verifier.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { BudgetGuard } from '../../src/safety/budget-guard.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import type { PolicyConfig } from '../../src/shared/config-schema.js';
import { PolicyDeniedError } from '../../src/shared/errors.js';

describe('Gate G9 — Security: Path Traversal, Symlink Rejection & ffprobe No-Shell Execution (S-08)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('neutraliza remoteSuggestedFilename malicioso (path traversal e command injection) e usa nome fisico interno', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g9-sec-'));
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

    try {
      const job = ledger.createJob({
        prompt: 'Security test',
        model: 'veo-2',
        aspectRatio: '16:9',
        requestedOutputs: 1,
        projectContextId: 'proj_1',
        accountContextId: 'acc_1',
        completionPolicy: {
          minVerifiedOutputs: 1,
          allowPartial: false,
          technicalRequirements: {
            minSizeBytes: 1024,
            expectedContainer: 'mp4',
            minDurationSec: 5,
            expectedWidth: 1920,
            expectedHeight: 1080,
          },
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
        remoteExternalId: 'rem_sec',
        controllerEpoch: 1,
        policyVersion: '1.0.0',
        registryVersion: 'reg_1',
        ruleApplied: 'LEVEL_1',
      });
      const rres = artifactStore.upsertRemoteResult({
        remoteSubmissionId: remoteSubmission.remoteSubmissionId,
        resultIndex: 0,
        remoteAssetId: 'asset_sec',
        status: 'READY',
      });

      const planner = new DefaultActionPlanner();
      const dlPlan = planner.plan(
        {
          mode: 'execute',
          actionKind: 'DOWNLOAD',
          targetControlId: 'ctrl_dl',
          transitionId: 'tr_dl',
          paramsCanonical: { resultIndex: 0 },
          jobId: job.jobId,
          registryVersion: 'reg_1',
          policyVersion: '1.0.0',
          observedConfigDigest: digest,
        },
        {
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
        }
      );
      const permit = permitStore.issuePermit(dlPlan, {
        controllerEpoch: 1,
        sessionEpoch: 1,
        pageId: 'p1',
        ttlMs: 15000,
      });

      const maliciousName = '../../Windows/System32/cmd.exe; rm -rf / #.mp4';
      const planned = artifactStore.planArtifactDownload({
        jobId: job.jobId,
        submissionIntentId: intent.submissionIntentId,
        remoteSubmissionId: remoteSubmission.remoteSubmissionId,
        remoteResultId: rres.remoteResultId,
        downloadPermitId: permit.permitId,
        remoteSuggestedFilename: maliciousName,
      });

      expect(planned.internalFilename).toMatch(/^art_[a-f0-9]+_idx0\.mp4$/);
      expect(planned.finalPath.startsWith(path.resolve(artifactsBaseDir))).toBe(true);
      expect(planned.remoteFilenameSanitized).not.toContain('..');
      expect(planned.remoteFilenameSanitized).not.toContain('/');
      expect(planned.remoteFilenameSanitized).not.toContain('\\');
      expect(planned.remoteFilenameSanitized).not.toContain(';');

      // Verificar execucao do ffprobeRunner com shell: false
      let capturedOptions: { shell: false; timeout: number } | null = null;
      const verifier = new DownloadVerifier({
        artifactStore,
        ffprobeTimeoutMs: 9500,
        ffprobeRunner: async (_filePath, opts) => {
          capturedOptions = opts;
          return {
            containerFormat: 'mp4',
            durationSec: 8.0,
            width: 1920,
            height: 1080,
          };
        },
      });

      const mp4Buf = Buffer.alloc(2048, 0);
      mp4Buf.writeUInt32BE(24, 0);
      mp4Buf.write('ftypisom', 4, 'ascii');
      artifactStore.writeStagingPart(planned.artifactId, mp4Buf);
      artifactStore.finalizeStagingToDownloaded(planned.artifactId);

      const verified = await verifier.verifyDownloadedArtifact(
        planned.artifactId,
        job.completionPolicy
      );
      expect(verified.artifact.status).toBe('VERIFIED');
      expect(capturedOptions).toEqual({ shell: false, timeout: 9500 });
    } finally {
      db.close();
    }

    expect(sanitizeRemoteFilenameMetadata('..\\..\\secret.mp4')).toBe('secret.mp4');
  });

  it('rejeita inicializacao do ArtifactStore quando artifactsBaseDir aponta para um symlink/junction (S-08)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g9-symlink-'));
    tempDirs.push(tmpDir);

    const realTarget = path.join(tmpDir, 'external_target');
    fs.mkdirSync(realTarget, { recursive: true });
    const symlinkDir = path.join(tmpDir, 'symlink_artifacts');
    fs.symlinkSync(realTarget, symlinkDir, 'junction');

    const db = new FlowDatabase(path.join(tmpDir, 'state.sqlite'));
    const eventRepo = new EventRepository(db, new Redactor());

    try {
      expect(
        () =>
          new ArtifactStore({
            flowDb: db,
            eventRepo,
            artifactsBaseDir: symlinkDir,
            stagingBaseDir: path.join(tmpDir, 'staging'),
          })
      ).toThrow(PolicyDeniedError);
    } finally {
      db.close();
    }
  });
});
