import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BrowserManager } from '../../src/infrastructure/browser/browser-manager.js';
import { NavigationGuard } from '../../src/infrastructure/browser/navigation-guard.js';
import { Redactor } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import type { PolicyConfig } from '../../src/shared/config-schema.js';
import { ConfigValidationError } from '../../src/shared/errors.js';

const samplePolicy: PolicyConfig = {
  policyVersion: '1.0.0',
  releasePhase: 'A',
  allowedWorkOrigins: ['https://labs.google', 'https://flow.google'],
  allowedLoginOrigins: ['https://accounts.google.com'],
  authorizedProjects: ['proj_ok'],
  authorizedAccounts: ['acct_ok'],
  limits: {
    maxSubmissionsPerRun: 1,
    maxSubmissionsPerWindow: 5,
    windowDurationMs: 3600000,
    maxRequestedOutputsPerRun: 1,
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

describe('Gate G3 — Unit: Dedicated Profile, Session Epoch & Navigation Guard (§7, A-03, S-08)', () => {
  it('rejeita perfil pessoal do Chrome no BrowserManager e incrementa sessionEpoch na recarga', () => {
    const flowDb = new FlowDatabase(':memory:');
    const permitStore = new PermitStore(flowDb, new EventRepository(flowDb, new Redactor()));
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g3-bm-'));

    try {
      expect(
        () =>
          new BrowserManager({
            profileDir: 'C:\\Users\\admin\\AppData\\Local\\Google\\Chrome\\User Data',
            controllerEpoch: 1,
            permitStore,
          })
      ).toThrow(ConfigValidationError);

      const bm = new BrowserManager({
        profileDir: path.join(tmpDir, 'profile'),
        controllerEpoch: 1,
        permitStore,
      });

      const s1 = bm.openDedicatedSession();
      expect(s1.sessionEpoch).toBe(1);
      expect(s1.isOpen).toBe(true);

      const s2 = bm.notifyPageReloadOrSessionChange('Recarga manual detectada');
      expect(s2.sessionEpoch).toBe(2);
      expect(s2.pageId).toBe('page_work_2');
    } finally {
      flowDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('distingue navegacao principal de sub-recursos CDN e valida allowlist de login vs trabalho', () => {
    const guard = new NavigationGuard(samplePolicy);

    // 1. Sub-recurso (font/script/image) de CDN externo em HTTPS -> permitido (Arquitetura §7)
    const subRes = guard.checkNavigation({
      url: 'https://fonts.gstatic.com/s/inter/v12/font.woff2',
      isMainFrame: false,
      resourceType: 'font',
      isLoginLifecycleMode: false,
    });
    expect(subRes.allowed).toBe(true);

    // 2. Navegacao principal (document) para site externo nao autorizado -> bloqueado com POLICY
    const badDoc = guard.checkNavigation({
      url: 'https://evil-phishing.example.com/flow',
      isMainFrame: true,
      resourceType: 'document',
      isLoginLifecycleMode: false,
    });
    expect(badDoc.allowed).toBe(false);
    expect(badDoc.pauseRequired).toBe(true);
    expect(badDoc.pauseReason).toBe('POLICY');

    // 3. Redirecionamento para accounts.google.com durante operacao -> pausa com AUTH (sessao expirada)
    const loginRedirect = guard.checkNavigation({
      url: 'https://accounts.google.com/ServiceLogin',
      isMainFrame: true,
      resourceType: 'document',
      isLoginLifecycleMode: false,
    });
    expect(loginRedirect.allowed).toBe(false);
    expect(loginRedirect.pauseReason).toBe('AUTH');

    // 4. Em modo login explicito, accounts.google.com e permitido
    const loginAllowed = guard.checkNavigation({
      url: 'https://accounts.google.com/ServiceLogin',
      isMainFrame: true,
      resourceType: 'document',
      isLoginLifecycleMode: true,
    });
    expect(loginAllowed.allowed).toBe(true);
  });
});
