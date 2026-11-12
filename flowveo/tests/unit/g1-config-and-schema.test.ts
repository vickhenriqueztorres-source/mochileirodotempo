import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { validateAndResolveConfig } from '../../src/shared/config-schema.js';
import { ConfigValidationError } from '../../src/shared/errors.js';

const validApp = {
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
  runtimeDir: './runtime',
};

const validPolicy = {
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
    minFreeDiskBytes: 524288000,
    maxDownloadBytesPerSession: 1073741824,
    maxSessionDurationMs: 3600000,
    maxActionsPerSession: 200,
    permitTtlMs: 15000,
    maxDownloadRetries: 2,
    maxConsecutiveFailures: 3,
  },
};

describe('Gate G1 — Unit: Config Validation & SQLite 20+ Tables Schema', () => {
  it('aprova configuracao padrao valida e resolve caminhos de runtime', () => {
    const resolved = validateAndResolveConfig(validApp, validPolicy);
    expect(resolved.app.mode).toBe('observe');
    expect(resolved.app.executionEnabled).toBe(false);
    expect(resolved.resolvedPaths.databaseFile).toContain('flow.db');
  });

  it('rejeita chaves desconhecidas (strict mode — A-01)', () => {
    expect(() =>
      validateAndResolveConfig({ ...validApp, unknownSecretFlag: true }, validPolicy)
    ).toThrow(ConfigValidationError);
  });

  it('bloqueia executionEnabled=true ou mode=execute na Release A (A-18)', () => {
    expect(() =>
      validateAndResolveConfig({ ...validApp, executionEnabled: true }, validPolicy)
    ).toThrow(/Release A bloqueia executionEnabled=true/);

    expect(() =>
      validateAndResolveConfig(validApp, validPolicy, { mode: 'execute' })
    ).toThrow(/bloqueada pela politica da Release A/);
  });

  it('impede que flags CLI ampliem limites acima da politica aprovada (Arquitetura §21)', () => {
    expect(() =>
      validateAndResolveConfig(validApp, validPolicy, { maxSubmissionsPerRun: 5 })
    ).toThrow(/nao pode ampliar o limite da politica/);
  });

  it('rejeita runtimeDir apontando para perfil pessoal do Chrome (A-03)', () => {
    expect(() =>
      validateAndResolveConfig(
        {
          ...validApp,
          runtimeDir: 'C:\\Users\\user\\AppData\\Local\\Google\\Chrome\\User Data\\Default',
        },
        validPolicy
      )
    ).toThrow(/perfil pessoal do navegador/);
  });

  it('cria todas as tabelas obrigatorias da Arquitetura §15 e ativa WAL + synchronous=FULL + foreign_keys=ON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g1-unit-'));
    const dbPath = path.join(tmpDir, 'test.db');
    const flowDb = new FlowDatabase(dbPath);
    try {
      const pragmas = flowDb.getPragmaStatus();
      expect(pragmas.journalMode.toLowerCase()).toBe('wal');
      expect(pragmas.synchronous).toBe(2); // FULL
      expect(pragmas.foreignKeys).toBe(1);
      expect(pragmas.busyTimeout).toBe(5000);

      const tables = flowDb.listTables();
      const expectedTables = [
        'action_plans',
        'artifact_links',
        'artifacts',
        'budget_reservations',
        'checkpoints',
        'circuit_breaker_state',
        'controller_leases',
        'controls',
        'correlation_decisions',
        'events',
        'execution_permits',
        'job_attempts',
        'jobs',
        'mapping_scopes',
        'operator_approvals',
        'policy_versions',
        'registry_versions',
        'remote_observations',
        'remote_results',
        'remote_submissions',
        'schema_migrations',
        'submission_intents',
        'transitions',
        'usage_counters',
      ];
      for (const tbl of expectedTables) {
        expect(tables).toContain(tbl);
      }
    } finally {
      flowDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
