import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RecoveryService } from '../../src/application/recovery-service.js';
import type { ActionOutcome } from '../../src/domain/actions/action-types.js';
import { SubmissionLedger } from '../../src/execution/submission-ledger.js';
import { DefaultActionPlanner } from '../../src/flow/action-planner.js';
import type { AuthorizedExecutor, FlowReader } from '../../src/flow/contracts.js';
import { ArtifactStore } from '../../src/infrastructure/artifacts/artifact-store.js';
import { DownloadVerifier } from '../../src/infrastructure/artifacts/download-verifier.js';
import { LocalArtifactReconciler } from '../../src/infrastructure/artifacts/local-reconciler.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { BudgetGuard } from '../../src/safety/budget-guard.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import { PolicyEngine } from '../../src/safety/policy-engine.js';
import { DefaultSafetyGateway } from '../../src/safety/safety-gateway.js';
import type { PolicyConfig } from '../../src/shared/config-schema.js';

function makeValidMp4(size = 2048): Buffer {
  const b = Buffer.alloc(size, 0);
  b.writeUInt32BE(24, 0);
  b.write('ftypisom', 4, 'ascii');
  return b;
}

describe('Gate G9 — Chaos: Download Crash (.part), Orphan Files, Missing Files & Download Retry Without Regeneration (BC-15, BC-16)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('rebaixa apenas DOWNLOAD do mesmo remoteResultId quando a 1a tentativa falha, reconcilia .part/orfao/missing e faz 0 novas submissoes', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g9-chaos-'));
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
        approvedForModes: ['execute'],
      }),
      permitTtlMs: 15000,
    });

    const artifactsBaseDir = path.join(tmpDir, 'artifacts');
    const stagingBaseDir = path.join(tmpDir, 'staging');
    const artifactStore = new ArtifactStore({
      flowDb: db,
      eventRepo,
      artifactsBaseDir,
      stagingBaseDir,
    });
    const verifier = new DownloadVerifier({ artifactStore });
    const localReconciler = new LocalArtifactReconciler(artifactStore);

    try {
      const job = ledger.createJob({
        prompt: 'Chaos download recovery',
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
      ledger.confirmSubmission({
        submissionIntentId: intent.submissionIntentId,
        scopeId: 'proj_1',
        remoteExternalId: 'rem_chaos_1',
        controllerEpoch: 1,
        policyVersion: '1.0.0',
        registryVersion: 'reg_1',
        ruleApplied: 'LEVEL_1',
      });

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
          selectedModel: 'veo-2',
          selectedAspectRatio: '16:9',
          selectedOutputsCount: 1,
          promptText: 'Chaos download recovery',
          promptDigestSha256: job.promptDigestSha256,
          uploadReadyFilename: null,
          observedConfigDigest: digest,
          observedRevision: 1,
        }),
        inspectResults: async () => ({
          isVirtualizedOrPartial: false,
          items: [
            {
              remoteExternalId: 'rem_chaos_1',
              remoteAssetId: 'asset_chaos_0',
              resultIndex: 0,
              status: 'READY',
              promptSnippetDigest: job.promptDigestSha256,
              createdAtLabel: 'Just now',
              downloadControlId: 'ctrl_download_0',
            },
          ],
        }),
      };

      const executor: AuthorizedExecutor = {
        execute: async (permitId: string): Promise<ActionOutcome> => ({
          permitId,
          planId: 'p',
          actionKind: 'DOWNLOAD',
          status: 'SUCCESS',
          observedRevisionAfter: 1,
          postconditionVerified: true,
          details: {},
        }),
      };

      const recovery = new RecoveryService({
        flowDb: db,
        ledger,
        permitStore,
        artifactStore,
        verifier,
        localReconciler,
        reader,
        planner: new DefaultActionPlanner(),
        safetyGateway,
        executor,
        maxDownloadRetries: 2,
        registryVersion: 'reg_1',
        policyVersion: '1.0.0',
        downloadProvider: async (_remoteResultId, attempt) => {
          if (attempt === 1) {
            // Tentativa 1: entrega bytes corrompidos/HTML -> falha na verificacao e faz retry de DOWNLOAD na tentativa 2!
            return {
              suggestedFilename: 'corrupted.mp4',
              bytes: Buffer.from('502 Bad Gateway'.repeat(100), 'utf-8'),
            };
          }
          return {
            suggestedFilename: 'good.mp4',
            bytes: makeValidMp4(4096),
          };
        },
      });

      const outcome = await recovery.collectAndVerifyJobResults(job.jobId);
      expect(outcome.job.status).toBe('COMPLETED');
      expect(outcome.submissionClicksTriggered).toBe(0);
      expect(outcome.verifiedArtifacts).toHaveLength(1);
      expect(Object.values(outcome.downloadAttemptsByResult)[0]).toBe(2);

      // Testar reconciliacao de arquivo .part abandonado, arquivo orfao e arquivo deletado (MISSING)
      const stalePartPath = path.join(stagingBaseDir, 'stale_abandoned.part');
      fs.writeFileSync(stalePartPath, 'partial');

      const orphanPath = path.join(artifactsBaseDir, job.jobId, 'unlinked_orphan_video.mp4');
      fs.writeFileSync(orphanPath, makeValidMp4(2048));

      // Deletar externamente o arquivo VERIFIED do disco
      const verifiedFile = outcome.verifiedArtifacts[0]!;
      fs.rmSync(verifiedFile.finalPath, { force: true });

      const recReport = recovery.reconcileLocalArtifacts();
      expect(recReport.cleanedStagingPartFiles).toContain(path.resolve(stalePartPath));
      expect(recReport.orphanFilesOnDisk).toContain(path.resolve(orphanPath));
      expect(recReport.markedMissingArtifactIds).toContain(verifiedFile.artifactId);

      const updatedArtifact = artifactStore.getArtifactById(verifiedFile.artifactId);
      expect(updatedArtifact.status).toBe('MISSING');
    } finally {
      db.close();
    }
  });
});
