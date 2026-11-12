import type { ContextSnapshot } from '../flow/contracts.js';
import { FlowDatabase } from '../infrastructure/persistence/database.js';
import { EventRepository } from '../infrastructure/persistence/repositories/event-repository.js';
import type { RawControlObservation } from './passive-discovery.js';

export interface DriftEvaluationResult {
  driftDetected: boolean;
  scopeMismatchReasons: string[];
  invalidatedControlIds: string[];
  invalidatedTransitionIds: string[];
  candidateSelectorFallbacksRequiringReview: string[];
}

/**
 * DriftDetector (Arquitetura §8.4 / A-14):
 * - Compara invariantes locais relevantes (escopo, container, role/name, unicidade) e NAO o hash do DOM inteiro.
 * - Mudanca relevante invalida o controle e, em cascata, todas as transicoes dependentes.
 * - Alternativa de seletor vira 'candidate'; JAMAIS substitui silenciosamente alvo com custo.
 */
export class DriftDetector {
  private readonly flowDb: FlowDatabase;
  private readonly eventRepo: EventRepository;

  constructor(flowDb: FlowDatabase, eventRepo: EventRepository) {
    this.flowDb = flowDb;
    this.eventRepo = eventRepo;
  }

  public evaluateAndInvalidateOnDrift(params: {
    registryVersion: string;
    currentContext: ContextSnapshot;
    liveControls: ReadonlyArray<RawControlObservation>;
    policyVersion: string;
  }): DriftEvaluationResult {
    const scopeMismatchReasons: string[] = [];
    const invalidatedControlIds: string[] = [];
    const invalidatedTransitionIds: string[] = [];
    const candidateSelectorFallbacksRequiringReview: string[] = [];

    return this.flowDb.writeTransaction((db) => {
      const regRow = db
        .prepare(
          `SELECT r.scope_id, s.locale, s.viewport_width, s.viewport_height,
                  s.account_context_id, s.project_context_id, s.creation_mode, s.observed_variant
           FROM registry_versions r
           JOIN mapping_scopes s ON s.scope_id = r.scope_id
           WHERE r.registry_version = ?`
        )
        .get(params.registryVersion) as
        | {
            scope_id: string;
            locale: string;
            viewport_width: number;
            viewport_height: number;
            account_context_id: string;
            project_context_id: string;
            creation_mode: string;
            observed_variant: string;
          }
        | undefined;

      if (!regRow) {
        throw new Error(`RegistryVersion '${params.registryVersion}' nao encontrada.`);
      }

      if (regRow.locale !== params.currentContext.locale) {
        scopeMismatchReasons.push(`locale (${regRow.locale} -> ${params.currentContext.locale})`);
      }
      if (
        regRow.viewport_width !== params.currentContext.viewport.width ||
        regRow.viewport_height !== params.currentContext.viewport.height
      ) {
        scopeMismatchReasons.push('viewport alterado');
      }
      if (regRow.account_context_id !== params.currentContext.accountContextId) {
        scopeMismatchReasons.push('accountContextId alterado');
      }
      if (regRow.project_context_id !== params.currentContext.projectContextId) {
        scopeMismatchReasons.push('projectContextId alterado');
      }
      if (regRow.creation_mode !== params.currentContext.creationMode) {
        scopeMismatchReasons.push('creationMode alterado');
      }
      if (regRow.observed_variant !== params.currentContext.observedVariant) {
        scopeMismatchReasons.push('observedVariant alterado');
      }

      const storedControls = db
        .prepare(
          `SELECT control_id, container_id, candidates_json, status
           FROM controls WHERE registry_version = ?`
        )
        .all(params.registryVersion) as Array<{
        control_id: string;
        container_id: string;
        candidates_json: string;
        status: string;
      }>;

      const liveMap = new Map(params.liveControls.map((c) => [c.controlId, c]));
      const nowIso = new Date().toISOString();

      for (const sc of storedControls) {
        const live = liveMap.get(sc.control_id);
        const candidates = JSON.parse(sc.candidates_json) as Array<{
          strategy: string;
          role?: string;
          name?: string;
          label?: string;
        }>;
        const primary = candidates[0];

        let controlDrifted = scopeMismatchReasons.length > 0;
        if (!live || !live.visible || live.matchesCount !== 1) {
          controlDrifted = true;
        } else if (live.containerId !== sc.container_id) {
          controlDrifted = true;
        } else if (primary && (live.role !== primary.role || live.name !== primary.name)) {
          controlDrifted = true;
          // Se o seletor secundario (ex.: label) ainda bate, registrar como candidato para revisao,
          // mas NUNCA substituir silenciosamente!
          const secondary = candidates.find((c) => c.strategy === 'label');
          if (secondary && live.label && secondary.label === live.label) {
            candidateSelectorFallbacksRequiringReview.push(sc.control_id);
          }
        }

        if (controlDrifted) {
          invalidatedControlIds.push(sc.control_id);
          db.prepare(
            `UPDATE controls
             SET status = 'invalidated', observed_matches = ?, updated_at = ?
             WHERE control_id = ? AND registry_version = ?`
          ).run(live?.matchesCount ?? 0, nowIso, sc.control_id, params.registryVersion);

          // Invalidar em cascata todas as transicoes dependentes desse controlId (A-14)
          const depTransitions = db
            .prepare(
              `SELECT transition_id FROM transitions
               WHERE control_id = ? AND registry_version = ?`
            )
            .all(sc.control_id, params.registryVersion) as Array<{ transition_id: string }>;

          for (const dt of depTransitions) {
            if (!invalidatedTransitionIds.includes(dt.transition_id)) {
              invalidatedTransitionIds.push(dt.transition_id);
            }
            db.prepare(
              `UPDATE transitions
               SET status = 'invalidated', updated_at = ?
               WHERE transition_id = ? AND registry_version = ?`
            ).run(nowIso, dt.transition_id, params.registryVersion);
          }
        }
      }

      const driftDetected =
        scopeMismatchReasons.length > 0 ||
        invalidatedControlIds.length > 0 ||
        invalidatedTransitionIds.length > 0;

      if (driftDetected) {
        const reason = `UI Drift detectado: escopo=[${scopeMismatchReasons.join(', ')}], controles=[${invalidatedControlIds.join(', ')}], transicoes=[${invalidatedTransitionIds.join(', ')}]`;
        db.prepare(
          `UPDATE registry_versions
           SET status = 'INVALIDATED', invalidated_at = ?, invalidation_reason = ?
           WHERE registry_version = ?`
        ).run(nowIso, reason, params.registryVersion);

        this.eventRepo.insertWithinTransaction(db, {
          eventType: 'action.denied',
          correlationId: params.registryVersion,
          controllerEpoch: params.currentContext.controllerEpoch,
          policyVersion: params.policyVersion,
          registryVersion: params.registryVersion,
          reason,
          payload: {
            scopeMismatchReasons,
            invalidatedControlIds,
            invalidatedTransitionIds,
            candidateSelectorFallbacksRequiringReview,
          },
        });
      }

      return {
        driftDetected,
        scopeMismatchReasons,
        invalidatedControlIds,
        invalidatedTransitionIds,
        candidateSelectorFallbacksRequiringReview,
      };
    });
  }
}
