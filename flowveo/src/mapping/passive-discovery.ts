import crypto from 'node:crypto';
import { z } from 'zod';
import { ActionKindSchema, type ActionKind } from '../domain/actions/action-types.js';
import type { ContextSnapshot } from '../flow/contracts.js';
import { Redactor, sha256Hex } from '../infrastructure/observability/redactor.js';
import { FlowDatabase } from '../infrastructure/persistence/database.js';
import { EventRepository } from '../infrastructure/persistence/repositories/event-repository.js';
import { OperationModeSchema, type OperationMode } from '../shared/config-schema.js';

export const LocatorSpecSchema = z
  .object({
    strategy: z.enum(['role_name', 'label', 'placeholder', 'testId', 'css']),
    containerId: z.string().min(1),
    role: z.string().optional(),
    name: z.string().optional(),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    testId: z.string().optional(),
    css: z
      .string()
      .optional()
      .refine((v) => !v || (!v.includes(':first') && !v.includes(':nth') && !v.includes('first()') && !v.includes('nth(')), {
        message: 'Proibido usar first() ou nth() para esconder duplicidade (Arquitetura §8.3 / A-12).',
      }),
  })
  .strict();

export type LocatorSpec = z.infer<typeof LocatorSpecSchema>;

export const PredicateSpecSchema = z
  .object({
    kind: z.enum([
      'control_visible',
      'control_text_equals',
      'control_value_equals',
      'menu_open_in_container',
      'upload_ready',
      'url_matches',
    ]),
    targetControlId: z.string().optional(),
    containerId: z.string().optional(),
    expectedValue: z.string().optional(),
  })
  .strict();

export type PredicateSpec = z.infer<typeof PredicateSpecSchema>;

export interface MappingScope {
  scopeId: string;
  locale: string;
  viewport: { width: number; height: number };
  accountContextId: string;
  projectContextId: string;
  creationMode: string;
  observedVariant: string;
}

export interface ControlDefinition {
  id: string;
  registryVersion: string;
  scopeId: string;
  pageState: string;
  containerId: string;
  candidates: LocatorSpec[];
  expectedMatches: 1;
  observedMatches: number;
  capabilities: ActionKind[];
  status: 'candidate' | 'validated' | 'invalidated';
  evidenceIds: string[];
}

export interface TransitionDefinition {
  id: string;
  registryVersion: string;
  scopeId: string;
  sourceState: string;
  actionKind: ActionKind;
  controlId: string;
  preconditions: PredicateSpec[];
  expectedPostconditions: PredicateSpec[];
  timeoutMs: number;
  approvedForModes: OperationMode[];
  risk: 'low' | 'medium' | 'cost-bearing';
  evidenceIds: string[];
  status: 'candidate' | 'validated' | 'invalidated';
}

export interface RawControlObservation {
  controlId: string;
  containerId: string;
  role: string;
  name: string;
  label?: string;
  placeholder?: string;
  testId?: string;
  visible: boolean;
  enabled: boolean;
  matchesCount: number;
}

export interface PassiveDiscoveryReport {
  registryVersion: string;
  scopeId: string;
  discoveredControls: ControlDefinition[];
  ambiguousControlIds: string[];
  statesNotObserved: string[];
  sanitizedSummaryJson: string;
}

const DEFAULT_STATES_NOT_OBSERVED = [
  'MODEL_MENU_OPEN',
  'ASPECT_RATIO_CONFIGURED',
  'PROMPT_FILLED_STABILIZED',
  'START_FRAME_UPLOADED',
  'GENERATION_SUBMITTED',
  'REMOTE_RESULT_PROCESSING',
  'REMOTE_RESULT_READY',
  'REMOTE_RESULT_FAILED',
  'DOWNLOAD_MODAL_OPEN',
];

/**
 * PassiveDiscovery (Arquitetura §8.1 / A-06, A-07, A-08, A-12):
 * - Coleta controles candidatos sem atribuir capacidade executavel por heuristica (capabilities = []).
 * - Todo controle nasce apenas como 'candidate'.
 * - Detecta duplicidade (matchesCount !== 1) e registra na lista de ambiguos.
 */
export class PassiveDiscovery {
  private readonly flowDb: FlowDatabase;
  private readonly eventRepo: EventRepository;
  private readonly redactor: Redactor;

  constructor(flowDb: FlowDatabase, eventRepo: EventRepository, redactor: Redactor) {
    this.flowDb = flowDb;
    this.eventRepo = eventRepo;
    this.redactor = redactor;
  }

  public computeScopeId(context: ContextSnapshot): string {
    return `scp_${sha256Hex(
      `${context.locale}|${context.viewport.width}x${context.viewport.height}|${context.accountContextId}|${context.projectContextId}|${context.creationMode}|${context.observedVariant}`
    ).slice(0, 16)}`;
  }

  public observeAndRegisterCandidates(params: {
    context: ContextSnapshot;
    pageState: string;
    rawControls: ReadonlyArray<RawControlObservation>;
    policyVersion: string;
  }): PassiveDiscoveryReport {
    const scopeId = this.computeScopeId(params.context);
    const registryVersion = `reg_${crypto.randomUUID().slice(0, 12)}`;
    const nowIso = new Date().toISOString();
    const evidenceId = `evd_obs_${crypto.randomUUID().slice(0, 8)}`;

    const discoveredControls: ControlDefinition[] = [];
    const ambiguousControlIds: string[] = [];

    for (const rc of params.rawControls) {
      const candidates: LocatorSpec[] = [
        {
          strategy: 'role_name',
          containerId: rc.containerId,
          role: rc.role,
          name: rc.name,
        },
      ];
      if (rc.label) {
        candidates.push({ strategy: 'label', containerId: rc.containerId, label: rc.label });
      }
      if (rc.placeholder) {
        candidates.push({
          strategy: 'placeholder',
          containerId: rc.containerId,
          placeholder: rc.placeholder,
        });
      }
      if (rc.testId) {
        candidates.push({ strategy: 'testId', containerId: rc.containerId, testId: rc.testId });
      }

      if (rc.matchesCount !== 1) {
        ambiguousControlIds.push(rc.controlId);
      }

      // Regra A-08 / Arquitetura §8.1: Nao atribuir capacidade executavel por heuristica!
      // Todo controle descoberto passivamente tem status='candidate' e capabilities=[]
      discoveredControls.push({
        id: rc.controlId,
        registryVersion,
        scopeId,
        pageState: params.pageState,
        containerId: rc.containerId,
        candidates,
        expectedMatches: 1,
        observedMatches: rc.matchesCount,
        capabilities: [],
        status: 'candidate',
        evidenceIds: [evidenceId],
      });
    }

    const statesNotObserved = DEFAULT_STATES_NOT_OBSERVED.filter(
      (s) => s !== params.pageState
    );

    const coverageSummary = {
      totalControls: discoveredControls.length,
      validatedControls: 0,
      candidateControls: discoveredControls.length,
      invalidatedControls: 0,
      ambiguousControlIds,
    };

    this.flowDb.writeTransaction((db) => {
      db.prepare(
        `INSERT OR IGNORE INTO mapping_scopes (
          scope_id, locale, viewport_width, viewport_height,
          account_context_id, project_context_id, creation_mode, observed_variant, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        scopeId,
        params.context.locale,
        params.context.viewport.width,
        params.context.viewport.height,
        params.context.accountContextId,
        params.context.projectContextId,
        params.context.creationMode,
        params.context.observedVariant,
        nowIso
      );

      db.prepare(
        `INSERT INTO registry_versions (
          registry_version, scope_id, status,
          states_not_observed_json, coverage_summary_json, created_at
        ) VALUES (?, ?, 'DRAFT', ?, ?, ?)`
      ).run(
        registryVersion,
        scopeId,
        JSON.stringify(statesNotObserved),
        JSON.stringify(coverageSummary),
        nowIso
      );

      const insertCtrl = db.prepare(
        `INSERT INTO controls (
          control_id, registry_version, scope_id, page_state, container_id,
          candidates_json, expected_matches, observed_matches,
          capabilities_json, status, evidence_ids_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'candidate', ?, ?)`
      );

      for (const ctrl of discoveredControls) {
        insertCtrl.run(
          ctrl.id,
          registryVersion,
          scopeId,
          ctrl.pageState,
          ctrl.containerId,
          JSON.stringify(ctrl.candidates),
          ctrl.observedMatches,
          JSON.stringify(ctrl.capabilities),
          JSON.stringify(ctrl.evidenceIds),
          nowIso
        );
      }

      this.eventRepo.insertWithinTransaction(db, {
        eventType: 'action.observed',
        correlationId: registryVersion,
        controllerEpoch: params.context.controllerEpoch,
        policyVersion: params.policyVersion,
        registryVersion,
        reason: `Observacao passiva concluiu com ${discoveredControls.length} candidatos (0 mutacoes)`,
        payload: {
          scopeId,
          registryVersion,
          totalCandidates: discoveredControls.length,
          ambiguousCount: ambiguousControlIds.length,
        },
      });
    });

    // Export sanitizado sem accountContextId bruto nem URLs com tokens (A-15)
    const sanitizedSummaryJson = this.redactor.sanitizeToJson({
      registryVersion,
      scopeId,
      locale: params.context.locale,
      viewport: params.context.viewport,
      accountContextDigest: sha256Hex(params.context.accountContextId),
      projectContextDigest: sha256Hex(params.context.projectContextId),
      discoveredControls: discoveredControls.map((c) => ({
        id: c.id,
        containerId: c.containerId,
        observedMatches: c.observedMatches,
        status: c.status,
        capabilities: c.capabilities,
      })),
      ambiguousControlIds,
      statesNotObserved,
      generationHomologated: false,
    });

    return {
      registryVersion,
      scopeId,
      discoveredControls,
      ambiguousControlIds,
      statesNotObserved,
      sanitizedSummaryJson,
    };
  }
}

export { ActionKindSchema, OperationModeSchema };
