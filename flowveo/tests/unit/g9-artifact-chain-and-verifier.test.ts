import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SubmissionLedger } from '../../src/execution/submission-ledger.js';
import { DefaultActionPlanner, computeObservedConfigDigest } from '../../src/flow/action-planner.js';
import { ArtifactStore } from '../../src/infrastructure/artifacts/artifact-store.js';
import { DownloadVerifier } from '../../src/infrastructure/artifacts/download-verifier.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { BudgetGuard } from '../../src/safety/budget-guard.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import type { PolicyConfig } from '../../src/shared/config-schema.js';
import { PolicyDeniedError } from '../../src/shared/errors.js';

function createValidMp4Buffer(sizeBytes = 2048): Buffer {
  const buf = Buffer.alloc(sizeBytes, 0);
  // ISO BMFF box: size=24 (0x00000018), type='ftyp', brand='isom'
  buf.writeUInt32BE(24, 0);
  buf.write('ftypisom', 4, 'ascii');
  return buf;
}

describe('Gate G9 — Unit: Mandatory Artifact Chain & Container Magic Bytes Verifier (BC-13, BC-14)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  function setupFixture() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g9-unit-'));
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

    const budgetGuard = new BudgetGuard(db, policyConfig);
    const ledger = new SubmissionLedger(db, eventRepo, budgetGuard);
    const permitStore = new PermitStore(db, eventRepo);
    const artifactStore = new ArtifactStore({
      flowDb: db,
      eventRepo,
      artifactsBaseDir: path.join(tmpDir, 'artifacts'),
      stagingBaseDir: path.join(tmpDir, 'staging'),
    });
    const verifier = new DownloadVerifier({ artifactStore });
    const planner = new DefaultActionPlanner();

    return { db, ledger, permitStore, artifactStore, verifier, planner };
  }

  it('rejeita artefato quando remoteResultId ou submissionIntentId pertence a outro Job (BC-13)', () => {
    const f = setupFixture();
    try {
      const job1 = f.ledger.createJob({
        prompt: 'Job 1',
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

      const job2 = f.ledger.createJob({
        prompt: 'Job 2',
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

      const digest = computeObservedConfigDigest({
        projectContextId: 'proj_1',
        model: 'veo-2',
        aspectRatio: '16:9',
        requestedOutputs: 1,
        promptDigestSha256: job1.promptDigestSha256,
      });

      const { intent: intent1 } = f.ledger.createIntentAndReserveBudget({
        jobId: job1.jobId,
        controllerEpoch: 1,
        observedConfigDigest: digest,
        baselineSnapshot: {},
        policyVersion: '1.0.0',
        registryVersion: 'reg_1',
      });
      f.ledger.markDispatchingBeforeClick(intent1.submissionIntentId);
      const { remoteSubmission: rsub1 } = f.ledger.confirmSubmission({
        submissionIntentId: intent1.submissionIntentId,
        scopeId: 'proj_1',
        remoteExternalId: 'rem_1',
        controllerEpoch: 1,
        policyVersion: '1.0.0',
        registryVersion: 'reg_1',
        ruleApplied: 'LEVEL_1',
      });

      const rres1 = f.artifactStore.upsertRemoteResult({
        remoteSubmissionId: rsub1.remoteSubmissionId,
        resultIndex: 0,
        remoteAssetId: 'asset_1',
        status: 'READY',
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

      const planJob2 = f.planner.plan(
        {
          mode: 'execute',
          actionKind: 'DOWNLOAD',
          targetControlId: 'ctrl_dl',
          transitionId: 'tr_dl',
          paramsCanonical: { resultIndex: 0 },
          jobId: job2.jobId,
          registryVersion: 'reg_1',
          policyVersion: '1.0.0',
          observedConfigDigest: digest,
        },
        ctx
      );
      const permitJob2 = f.permitStore.issuePermit(planJob2, {
        controllerEpoch: 1,
        sessionEpoch: 1,
        pageId: 'p1',
        ttlMs: 15000,
      });

      // Tentar vincular resultado/intencao do job1 ao job2 -> bloqueado (BC-13)!
      expect(() =>
        f.artifactStore.planArtifactDownload({
          jobId: job2.jobId,
          submissionIntentId: intent1.submissionIntentId,
          remoteSubmissionId: rsub1.remoteSubmissionId,
          remoteResultId: rres1.remoteResultId,
          downloadPermitId: permitJob2.permitId,
          remoteSuggestedFilename: 'video.mp4',
        })
      ).toThrow(PolicyDeniedError);
    } finally {
      f.db.close();
    }
  });

  it('rejeita pagina HTML 502 Bad Gateway salva como .mp4 e aprova MP4 integro com ftyp e SHA-256 (BC-14)', async () => {
    const f = setupFixture();
    try {
      const job = f.ledger.createJob({
        prompt: 'Job MP4',
        model: 'veo-2',
        aspectRatio: '16:9',
        requestedOutputs: 2,
        projectContextId: 'proj_1',
        accountContextId: 'acc_1',
        completionPolicy: {
          minVerifiedOutputs: 1,
          allowPartial: false,
          technicalRequirements: { minSizeBytes: 1024, expectedContainer: 'mp4' },
        },
      });

      const digest = sha256Hex('cfg');
      const { intent } = f.ledger.createIntentAndReserveBudget({
        jobId: job.jobId,
        controllerEpoch: 1,
        observedConfigDigest: digest,
        baselineSnapshot: {},
        policyVersion: '1.0.0',
        registryVersion: 'reg_1',
      });
      f.ledger.markDispatchingBeforeClick(intent.submissionIntentId);
      const { remoteSubmission } = f.ledger.confirmSubmission({
        submissionIntentId: intent.submissionIntentId,
        scopeId: 'proj_1',
        remoteExternalId: 'rem_ok',
        controllerEpoch: 1,
        policyVersion: '1.0.0',
        registryVersion: 'reg_1',
        ruleApplied: 'LEVEL_1',
      });

      // Teste de transicao nao-linear: OBSERVED -> READY direto (BC-12)
      f.artifactStore.upsertRemoteResult({
        remoteSubmissionId: remoteSubmission.remoteSubmissionId,
        resultIndex: 0,
        remoteAssetId: 'asset_0',
        status: 'OBSERVED',
      });
      const rres0 = f.artifactStore.upsertRemoteResult({
        remoteSubmissionId: remoteSubmission.remoteSubmissionId,
        resultIndex: 0,
        remoteAssetId: 'asset_0',
        status: 'READY',
      });
      expect(rres0.status).toBe('READY');

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

      // 1. Testar arquivo HTML corrompido salvo como .mp4
      const planHtml = f.planner.plan(
        {
          mode: 'execute',
          actionKind: 'DOWNLOAD',
          targetControlId: 'ctrl_dl_0',
          transitionId: 'tr_dl',
          paramsCanonical: { attempt: 1 },
          jobId: job.jobId,
          registryVersion: 'reg_1',
          policyVersion: '1.0.0',
          observedConfigDigest: digest,
        },
        ctx
      );
      const permitHtml = f.permitStore.issuePermit(planHtml, {
        controllerEpoch: 1,
        sessionEpoch: 1,
        pageId: 'p1',
        ttlMs: 15000,
      });

      const artHtml = f.artifactStore.planArtifactDownload({
        jobId: job.jobId,
        submissionIntentId: intent.submissionIntentId,
        remoteSubmissionId: remoteSubmission.remoteSubmissionId,
        remoteResultId: rres0.remoteResultId,
        downloadPermitId: permitHtml.permitId,
        remoteSuggestedFilename: 'bad_gateway.mp4',
      });

      const fakeHtmlBytes = Buffer.from('<html><body>502 Bad Gateway</body></html>'.repeat(60), 'utf-8');
      f.artifactStore.writeStagingPart(artHtml.artifactId, fakeHtmlBytes);
      f.artifactStore.finalizeStagingToDownloaded(artHtml.artifactId);

      const resHtml = await f.verifier.verifyDownloadedArtifact(
        artHtml.artifactId,
        job.completionPolicy
      );
      expect(resHtml.artifact.status).toBe('REJECTED');
      expect(resHtml.artifact.rejectionReason).toContain('Magic Bytes');
      expect(resHtml.chainLink).toBeNull();

      // 2. Testar arquivo MP4 real com box ftyp
      const planMp4 = f.planner.plan(
        {
          mode: 'execute',
          actionKind: 'DOWNLOAD',
          targetControlId: 'ctrl_dl_0',
          transitionId: 'tr_dl',
          paramsCanonical: { attempt: 2 },
          jobId: job.jobId,
          registryVersion: 'reg_1',
          policyVersion: '1.0.0',
          observedConfigDigest: digest,
        },
        ctx
      );
      const permitMp4 = f.permitStore.issuePermit(planMp4, {
        controllerEpoch: 1,
        sessionEpoch: 1,
        pageId: 'p1',
        ttlMs: 15000,
      });

      const artMp4 = f.artifactStore.planArtifactDownload({
        jobId: job.jobId,
        submissionIntentId: intent.submissionIntentId,
        remoteSubmissionId: remoteSubmission.remoteSubmissionId,
        remoteResultId: rres0.remoteResultId,
        downloadPermitId: permitMp4.permitId,
        remoteSuggestedFilename: 'valid_video.mp4',
      });

      const validMp4 = createValidMp4Buffer(4096);
      f.artifactStore.writeStagingPart(artMp4.artifactId, validMp4);
      f.artifactStore.finalizeStagingToDownloaded(artMp4.artifactId);

      const resMp4 = await f.verifier.verifyDownloadedArtifact(
        artMp4.artifactId,
        job.completionPolicy
      );
      expect(resMp4.artifact.status).toBe('VERIFIED');
      expect(resMp4.artifact.sha256).toHaveLength(64);
      expect(resMp4.chainLink?.verifiedChainDigest).toHaveLength(64);
    } finally {
      f.db.close();
    }
  });
});
