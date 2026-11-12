import { describe, expect, it } from 'vitest';
import type { ActionPlan } from '../../src/domain/actions/action-types.js';
import type { ContextSnapshot, CreationSnapshot } from '../../src/flow/contracts.js';
import { DefaultAuthorizedExecutor } from '../../src/infrastructure/browser/authorized-executor.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import { PolicyEngine } from '../../src/safety/policy-engine.js';
import { DefaultSafetyGateway } from '../../src/safety/safety-gateway.js';
import type { AppConfig, PolicyConfig } from '../../src/shared/config-schema.js';
import { PermitInvalidError } from '../../src/shared/errors.js';

const baseAppConfig: AppConfig = {
  mode: 'explore',
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

const basePolicyConfig: PolicyConfig = {
  policyVersion: '1.0.0',
  releasePhase: 'A',
  allowedWorkOrigins: ['https://labs.google'],
  allowedLoginOrigins: ['https://accounts.google.com'],
  authorizedProjects: ['proj_homolog_1'],
  authorizedAccounts: ['acct_homolog_1'],
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

const baseContext: ContextSnapshot = {
  controllerEpoch: 1,
  sessionEpoch: 1,
  pageId: 'page_main',
  url: 'https://labs.google/fx/flow/proj_homolog_1',
  locale: 'pt-BR',
  viewport: { width: 1440, height: 900 },
  accountContextId: 'acct_homolog_1',
  projectContextId: 'proj_homolog_1',
  creationMode: 'text-to-video',
  observedVariant: 'v1',
  observedRevision: 10,
  isAuthenticated: true,
  hasCaptchaOrVerification: false,
  humanInterferenceDetected: false,
};

const cfgDigest = sha256Hex('cfg_initial');

const baseCreation: CreationSnapshot = {
  selectedModel: 'veo-2',
  selectedAspectRatio: '16:9',
  selectedOutputsCount: 1,
  promptText: '',
  promptDigestSha256: sha256Hex(''),
  uploadReadyFilename: null,
  observedConfigDigest: cfgDigest,
  observedRevision: 10,
};

function makePlan(overrides?: Partial<ActionPlan>): ActionPlan {
  return {
    planId: `plan_${Math.random().toString(36).slice(2, 10)}`,
    mode: 'explore',
    actionKind: 'OPEN_UI',
    targetControlId: 'ctrl_model_menu',
    transitionId: 'tr_open_model_menu',
    paramsCanonical: { menu: 'model' },
    paramsDigestSha256: sha256Hex(JSON.stringify({ menu: 'model' })),
    projectContextId: 'proj_homolog_1',
    accountContextId: 'acct_homolog_1',
    registryVersion: 'reg_v1',
    policyVersion: '1.0.0',
    observedConfigDigest: cfgDigest,
    observedRevision: 10,
    ...overrides,
  };
}

describe('Gate G2 — Security: Policy Engine, Single-Use Permits & Pre-Mutation Revalidation', () => {
  it('nega mutacoes em observe e dry-run, nega SUBMIT na Release A e nega alvos duplicados (A-12, A-16, A-18)', async () => {
    const flowDb = new FlowDatabase(':memory:');
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);
    const permitStore = new PermitStore(flowDb, eventRepo);
    const policyEngine = new PolicyEngine(baseAppConfig, basePolicyConfig);

    let observedMatches = 1;
    const gateway = new DefaultSafetyGateway({
      policyEngine,
      permitStore,
      eventRepo,
      lookupTransition: () => ({
        controlStatus: 'validated',
        transitionStatus: 'validated',
        observedMatches,
        approvedForModes: ['explore', 'prepare', 'execute'],
      }),
      permitTtlMs: 15000,
    });

    try {
      // 1. Mutacao em observe -> negada
      const d1 = await gateway.authorize(makePlan({ mode: 'observe', actionKind: 'OPEN_UI' }), baseContext);
      expect(d1.allowed).toBe(false);

      // 2. Mutacao em dry-run -> negada
      const d2 = await gateway.authorize(makePlan({ mode: 'dry-run', actionKind: 'FILL' }), baseContext);
      expect(d2.allowed).toBe(false);

      // 3. SUBMIT na Release A -> negado incondicionalmente (A-18)
      const d3 = await gateway.authorize(makePlan({ mode: 'execute', actionKind: 'SUBMIT' }), baseContext);
      expect(d3.allowed).toBe(false);
      if (!d3.allowed) {
        expect(d3.code).toBe('RELEASE_A_SUBMIT_BLOCKED');
      }

      // 4. Alvo duplicado (observedMatches = 2) -> negado (A-12)
      observedMatches = 2;
      const d4 = await gateway.authorize(makePlan(), baseContext);
      expect(d4.allowed).toBe(false);
      if (!d4.allowed) {
        expect(d4.code).toBe('AMBIGUOUS_OR_MISSING_TARGET');
      }
    } finally {
      flowDb.close();
    }
  });

  it('consome permit uma unica vez (BC-06) e revoga se projeto, epoch ou config mudar antes do clique (S-03)', async () => {
    const flowDb = new FlowDatabase(':memory:');
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);
    const permitStore = new PermitStore(flowDb, eventRepo);
    const policyEngine = new PolicyEngine(baseAppConfig, basePolicyConfig);
    const gateway = new DefaultSafetyGateway({
      policyEngine,
      permitStore,
      eventRepo,
      lookupTransition: () => ({
        controlStatus: 'validated',
        transitionStatus: 'validated',
        observedMatches: 1,
        approvedForModes: ['explore'],
      }),
      permitTtlMs: 15000,
    });

    let liveCtx = { ...baseContext };
    let liveCreation = { ...baseCreation };
    let mutationsExecuted = 0;

    const executor = new DefaultAuthorizedExecutor({
      permitStore,
      driverPort: {
        readLiveContextAndConfig: async () => ({
          context: liveCtx,
          creation: liveCreation,
        }),
        performAuthorizedMutation: async () => {
          mutationsExecuted += 1;
          return {
            observedRevisionAfter: liveCtx.observedRevision + 1,
            postconditionVerified: true,
            details: { clicked: true },
          };
        },
      },
      registryVersionProvider: () => 'reg_v1',
      policyVersionProvider: () => '1.0.0',
    });

    try {
      const auth1 = await gateway.authorize(makePlan(), baseContext);
      expect(auth1.allowed).toBe(true);
      if (!auth1.allowed) return;

      // 1a execucao: sucesso
      const outcome = await executor.execute(auth1.permit.permitId);
      expect(outcome.status).toBe('SUCCESS');
      expect(mutationsExecuted).toBe(1);

      // 2a execucao do mesmo permitId -> rejeitada (BC-06)
      await expect(executor.execute(auth1.permit.permitId)).rejects.toThrow(PermitInvalidError);
      expect(mutationsExecuted).toBe(1);

      // Novo permit emitido, mas projeto muda na tela milissegundos antes do execute() (S-03 / BC-04)
      const auth2 = await gateway.authorize(makePlan(), baseContext);
      expect(auth2.allowed).toBe(true);
      if (!auth2.allowed) return;

      liveCtx = { ...baseContext, projectContextId: 'proj_WRONG_INTRUDER' };
      await expect(executor.execute(auth2.permit.permitId)).rejects.toThrow(/Contexto divergiu antes da mutacao/);
      expect(mutationsExecuted).toBe(1); // Zero cliques executados!

      const stored = permitStore.getPermitAndPlan(auth2.permit.permitId);
      expect(stored.permit.status).toBe('REVOKED');
    } finally {
      flowDb.close();
    }
  });
});
