import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ConfigValidationError } from './errors.js';

export const OperationModeSchema = z.enum([
  'observe',
  'bootstrap',
  'explore',
  'validate',
  'dry-run',
  'prepare',
  'execute',
  'reconcile',
]);

export type OperationMode = z.infer<typeof OperationModeSchema>;

export const ReleasePhaseSchema = z.enum(['A', 'B', 'C']);
export type ReleasePhase = z.infer<typeof ReleasePhaseSchema>;

export const AppConfigSchema = z
  .object({
    mode: OperationModeSchema,
    releasePhase: ReleasePhaseSchema.default('A'),
    executionEnabled: z.boolean(),
    maxConcurrentJobs: z.number().int().min(1).max(1),
    maxSubmissionsPerRun: z.number().int().min(1).max(20),
    maxRequestedOutputsPerRun: z.number().int().min(1).max(50),
    maxReadRetries: z.number().int().min(0).max(5),
    stopOnUnknownState: z.boolean().refine((v) => v === true, {
      message: 'stopOnUnknownState deve ser obrigatoriamente true',
    }),
    allowAutomaticResubmission: z.literal(false),
    allowAccountChanges: z.literal(false),
    allowPurchases: z.literal(false),
    allowDeletion: z.literal(false),
    allowRawTraces: z.boolean(),
    dryRunMutatesPage: z.literal(false),
    runtimeDir: z.string().min(1),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    // Regra A-18: Na Release A, geracao nunca pode ser habilitada
    if (cfg.releasePhase === 'A' && cfg.executionEnabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['executionEnabled'],
        message: 'A Release A bloqueia executionEnabled=true incondicionalmente (A-18).',
      });
    }
    if (cfg.releasePhase === 'A' && (cfg.mode === 'prepare' || cfg.mode === 'execute')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mode'],
        message: `Modo '${cfg.mode}' nao permitido na Release A (A-18).`,
      });
    }
    // Bloquear uso acidental do perfil pessoal do Chrome
    const normalizedRuntime = cfg.runtimeDir.replace(/\\/g, '/').toLowerCase();
    if (
      normalizedRuntime.includes('google/chrome/user data') ||
      normalizedRuntime.includes('microsoft/edge/user data')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['runtimeDir'],
        message: 'runtimeDir nao pode apontar para o perfil pessoal do navegador (A-03).',
      });
    }
  });

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const PolicyLimitsSchema = z
  .object({
    maxSubmissionsPerRun: z.number().int().min(1).max(20),
    maxSubmissionsPerWindow: z.number().int().min(1).max(100),
    windowDurationMs: z.number().int().min(60_000),
    maxRequestedOutputsPerRun: z.number().int().min(1).max(50),
    maxActiveJobs: z.number().int().min(1).max(1),
    minFreeDiskBytes: z.number().int().min(10 * 1024 * 1024),
    maxDownloadBytesPerSession: z.number().int().min(10 * 1024 * 1024),
    maxSessionDurationMs: z.number().int().min(60_000),
    maxActionsPerSession: z.number().int().min(1).max(5000),
    permitTtlMs: z.number().int().min(1000).max(60_000),
    maxDownloadRetries: z.number().int().min(0).max(5),
    maxConsecutiveFailures: z.number().int().min(1).max(10),
  })
  .strict();

export const PolicyConfigSchema = z
  .object({
    policyVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    releasePhase: ReleasePhaseSchema,
    allowedWorkOrigins: z.array(z.string().url()).min(1),
    allowedLoginOrigins: z.array(z.string().url()).min(1),
    authorizedProjects: z.array(z.string().min(1)).min(1),
    authorizedAccounts: z.array(z.string().min(1)).min(1),
    limits: PolicyLimitsSchema,
  })
  .strict();

export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;

export interface ValidatedEnvironmentConfig {
  app: AppConfig;
  policy: PolicyConfig;
  resolvedPaths: {
    runtimeDir: string;
    profileDir: string;
    databaseDir: string;
    databaseFile: string;
    artifactsDir: string;
    downloadsDir: string;
    stagingDir: string;
    locksDir: string;
  };
}

export function validateAndResolveConfig(
  rawAppConfig: unknown,
  rawPolicyConfig: unknown,
  cliOverrides?: Partial<{ mode: OperationMode; maxSubmissionsPerRun: number }>
): ValidatedEnvironmentConfig {
  const parsedApp = AppConfigSchema.safeParse(rawAppConfig);
  if (!parsedApp.success) {
    const reasons = parsedApp.error.issues.map((i) => i.message).join('; ');
    throw new ConfigValidationError(`Configuracao de aplicacao invalida (A-01): ${reasons}`, {
      issues: parsedApp.error.issues,
    });
  }

  const parsedPolicy = PolicyConfigSchema.safeParse(rawPolicyConfig);
  if (!parsedPolicy.success) {
    const reasons = parsedPolicy.error.issues.map((i) => i.message).join('; ');
    throw new ConfigValidationError(`Configuracao de politica invalida (A-01): ${reasons}`, {
      issues: parsedPolicy.error.issues,
    });
  }

  const app = { ...parsedApp.data };
  const policy = parsedPolicy.data;

  if (app.releasePhase !== policy.releasePhase) {
    throw new ConfigValidationError(
      `Divergencia de releasePhase entre app (${app.releasePhase}) e policy (${policy.releasePhase}).`
    );
  }

  // Flags CLI so podem restringir a politica aprovada, nunca ampliar permissoes (Arquitetura §21 / PRD §14)
  if (cliOverrides?.maxSubmissionsPerRun !== undefined) {
    if (cliOverrides.maxSubmissionsPerRun > policy.limits.maxSubmissionsPerRun) {
      throw new ConfigValidationError(
        `Flag --max-submissions (${cliOverrides.maxSubmissionsPerRun}) nao pode ampliar o limite da politica (${policy.limits.maxSubmissionsPerRun}).`
      );
    }
    if (cliOverrides.maxSubmissionsPerRun < 1) {
      throw new ConfigValidationError('Flag --max-submissions deve ser >= 1.');
    }
    app.maxSubmissionsPerRun = cliOverrides.maxSubmissionsPerRun;
  }

  if (cliOverrides?.mode !== undefined) {
    if (policy.releasePhase === 'A' && (cliOverrides.mode === 'prepare' || cliOverrides.mode === 'execute')) {
      throw new ConfigValidationError(
        `Flag de modo '${cliOverrides.mode}' bloqueada pela politica da Release A (A-18).`
      );
    }
    if (cliOverrides.mode === 'execute' && !app.executionEnabled) {
      throw new ConfigValidationError(
        'Flag mode=execute nao pode ativar execucao quando executionEnabled=false na politica.'
      );
    }
    app.mode = cliOverrides.mode;
  }

  if (app.maxSubmissionsPerRun > policy.limits.maxSubmissionsPerRun) {
    throw new ConfigValidationError(
      'app.maxSubmissionsPerRun excede policy.limits.maxSubmissionsPerRun.'
    );
  }

  if (app.maxRequestedOutputsPerRun > policy.limits.maxRequestedOutputsPerRun) {
    throw new ConfigValidationError(
      'app.maxRequestedOutputsPerRun excede policy.limits.maxRequestedOutputsPerRun.'
    );
  }

  const runtimeDir = path.resolve(app.runtimeDir);
  return {
    app,
    policy,
    resolvedPaths: {
      runtimeDir,
      profileDir: path.join(runtimeDir, 'profile'),
      databaseDir: path.join(runtimeDir, 'database'),
      databaseFile: path.join(runtimeDir, 'database', 'flow.db'),
      artifactsDir: path.join(runtimeDir, 'artifacts'),
      downloadsDir: path.join(runtimeDir, 'downloads'),
      stagingDir: path.join(runtimeDir, 'downloads', 'staging'),
      locksDir: path.join(runtimeDir, 'locks'),
    },
  };
}

export function loadConfigFromFiles(
  appConfigPath: string,
  policyConfigPath: string,
  cliOverrides?: Partial<{ mode: OperationMode; maxSubmissionsPerRun: number }>
): ValidatedEnvironmentConfig {
  let rawApp: unknown;
  let rawPolicy: unknown;
  try {
    rawApp = JSON.parse(fs.readFileSync(appConfigPath, 'utf-8'));
    rawPolicy = JSON.parse(fs.readFileSync(policyConfigPath, 'utf-8'));
  } catch (err) {
    throw new ConfigValidationError('Falha ao ler arquivos de configuracao JSON', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return validateAndResolveConfig(rawApp, rawPolicy, cliOverrides);
}
