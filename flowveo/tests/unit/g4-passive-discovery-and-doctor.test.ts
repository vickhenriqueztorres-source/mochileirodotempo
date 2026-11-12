import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DoctorService } from '../../src/application/doctor-service.js';
import type { ContextSnapshot } from '../../src/flow/contracts.js';
import { Redactor } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { PassiveDiscovery } from '../../src/mapping/passive-discovery.js';
import { validateAndResolveConfig } from '../../src/shared/config-schema.js';

const baseCtx: ContextSnapshot = {
  controllerEpoch: 1,
  sessionEpoch: 1,
  pageId: 'page_1',
  url: 'https://labs.google/fx/flow/proj_1',
  locale: 'pt-BR',
  viewport: { width: 1440, height: 900 },
  accountContextId: 'acct_secret_123',
  projectContextId: 'proj_secret_456',
  creationMode: 'text-to-video',
  observedVariant: 'v1',
  observedRevision: 1,
  isAuthenticated: true,
  hasCaptchaOrVerification: false,
  humanInterferenceDetected: false,
};

describe('Gate G4 — Unit: PassiveDiscovery & Doctor Diagnostics (A-02, A-07, A-08)', () => {
  it('cataloga controles apenas como candidate e com capabilities vazias (sem inferencia heuristica)', () => {
    const flowDb = new FlowDatabase(':memory:');
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);
    const discovery = new PassiveDiscovery(flowDb, eventRepo, redactor);

    try {
      const report = discovery.observeAndRegisterCandidates({
        context: baseCtx,
        pageState: 'INITIAL_PROJECT_VIEW',
        policyVersion: '1.0.0',
        rawControls: [
          {
            controlId: 'ctrl_generate_btn',
            containerId: 'composer_footer',
            role: 'button',
            name: 'Generate Video',
            visible: true,
            enabled: true,
            matchesCount: 1,
          },
          {
            controlId: 'ctrl_dup_icon',
            containerId: 'toolbar',
            role: 'button',
            name: 'Settings',
            visible: true,
            enabled: true,
            matchesCount: 2,
          },
        ],
      });

      expect(report.discoveredControls).toHaveLength(2);
      // Mesmo com nome "Generate Video", a descoberta passiva NUNCA habilita capacidade de SUBMIT
      expect(report.discoveredControls[0]?.status).toBe('candidate');
      expect(report.discoveredControls[0]?.capabilities).toEqual([]);
      expect(report.ambiguousControlIds).toEqual(['ctrl_dup_icon']);
      expect(report.statesNotObserved).toContain('GENERATION_SUBMITTED');

      // Export sanitizado nao contem os IDs brutos da conta/projeto (A-15)
      expect(report.sanitizedSummaryJson).not.toContain('acct_secret_123');
      expect(report.sanitizedSummaryJson).not.toContain('proj_secret_456');
    } finally {
      flowDb.close();
    }
  });

  it('executa doctor verificando espaco em disco e nunca declara geracao homologada (A-02)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g4-doc-'));
    const flowDb = new FlowDatabase(path.join(tmpDir, 'doc.db'));
    const doctor = new DoctorService();

    const envCfg = validateAndResolveConfig(
      {
        mode: 'observe',
        releasePhase: 'A',
        executionEnabled: false,
        maxConcurrentJobs: 1,
        maxSubmissionsPerRun: 1,
        maxRequestedOutputsPerRun: 1,
        maxReadRetries: 2,
        stopOnUnknownState: true,
        allowAutomaticResubmission: false,
        allowAccountChanges: false,
        allowPurchases: false,
        allowDeletion: false,
        allowRawTraces: false,
        dryRunMutatesPage: false,
        runtimeDir: tmpDir,
      },
      {
        policyVersion: '1.0.0',
        releasePhase: 'A',
        allowedWorkOrigins: ['https://labs.google'],
        allowedLoginOrigins: ['https://accounts.google.com'],
        authorizedProjects: ['proj_1'],
        authorizedAccounts: ['acct_1'],
        limits: {
          maxSubmissionsPerRun: 1,
          maxSubmissionsPerWindow: 5,
          windowDurationMs: 3600000,
          maxRequestedOutputsPerRun: 1,
          maxActiveJobs: 1,
          minFreeDiskBytes: 500_000_000,
          maxDownloadBytesPerSession: 1073741824,
          maxSessionDurationMs: 3600000,
          maxActionsPerSession: 200,
          permitTtlMs: 15000,
          maxDownloadRetries: 2,
          maxConsecutiveFailures: 3,
        },
      }
    );

    try {
      const okReport = doctor.runDiagnostics(envCfg, flowDb, 2_000_000_000);
      expect(okReport.overallReadyForObservation).toBe(true);
      expect(okReport.generationHomologated).toBe(false);

      const lowDiskReport = doctor.runDiagnostics(envCfg, flowDb, 1024);
      expect(lowDiskReport.overallReadyForObservation).toBe(false);
    } finally {
      flowDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
