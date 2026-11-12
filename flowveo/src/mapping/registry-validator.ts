import type { ContextSnapshot } from '../flow/contracts.js';
import { Redactor, sha256Hex } from '../infrastructure/observability/redactor.js';
import { FlowDatabase } from '../infrastructure/persistence/database.js';
import { DriftDetector, type DriftEvaluationResult } from './drift-detector.js';
import type { RawControlObservation } from './passive-discovery.js';

export interface RegistryValidationSummary {
  registryVersion: string;
  scopeId: string;
  status: 'DRAFT' | 'VALIDATED' | 'INVALIDATED';
  counts: {
    validatedControls: number;
    candidateControls: number;
    invalidatedControls: number;
    validatedTransitions: number;
    candidateTransitions: number;
    invalidatedTransitions: number;
  };
  statesNotObserved: string[];
  driftResult?: DriftEvaluationResult;
  sanitizedReportJson: string;
}

/**
 * RegistryValidator (Arquitetura §8.4 / J04 / A-13, A-15):
 * - Revalida contexto, unicidade e transicoes, promovendo o RegistryVersion para VALIDATED
 *   quando houver transicoes validadas e zero drift/invalidacao.
 * - Exporta relatorio sanitizado distinguindo validado, candidato, invalidado e nao observado.
 */
export class RegistryValidator {
  private readonly flowDb: FlowDatabase;
  private readonly driftDetector: DriftDetector;
  private readonly redactor: Redactor;

  constructor(flowDb: FlowDatabase, driftDetector: DriftDetector, redactor: Redactor) {
    this.flowDb = flowDb;
    this.driftDetector = driftDetector;
    this.redactor = redactor;
  }

  public validateRegistryContext(params: {
    registryVersion: string;
    currentContext: ContextSnapshot;
    liveControls: ReadonlyArray<RawControlObservation>;
    policyVersion: string;
  }): RegistryValidationSummary {
    const driftResult = this.driftDetector.evaluateAndInvalidateOnDrift(params);

    return this.flowDb.writeTransaction((db) => {
      const reg = db
        .prepare(
          `SELECT scope_id, status, states_not_observed_json
           FROM registry_versions WHERE registry_version = ?`
        )
        .get(params.registryVersion) as
        | { scope_id: string; status: string; states_not_observed_json: string }
        | undefined;

      if (!reg) {
        throw new Error(`RegistryVersion '${params.registryVersion}' nao encontrada.`);
      }

      const ctrlRows = db
        .prepare(`SELECT status FROM controls WHERE registry_version = ?`)
        .all(params.registryVersion) as Array<{ status: string }>;
      const trRows = db
        .prepare(`SELECT status FROM transitions WHERE registry_version = ?`)
        .all(params.registryVersion) as Array<{ status: string }>;

      const counts = {
        validatedControls: ctrlRows.filter((r) => r.status === 'validated').length,
        candidateControls: ctrlRows.filter((r) => r.status === 'candidate').length,
        invalidatedControls: ctrlRows.filter((r) => r.status === 'invalidated').length,
        validatedTransitions: trRows.filter((r) => r.status === 'validated').length,
        candidateTransitions: trRows.filter((r) => r.status === 'candidate').length,
        invalidatedTransitions: trRows.filter((r) => r.status === 'invalidated').length,
      };

      let finalStatus: 'DRAFT' | 'VALIDATED' | 'INVALIDATED' = 'DRAFT';
      if (
        driftResult.driftDetected ||
        counts.invalidatedControls > 0 ||
        counts.invalidatedTransitions > 0
      ) {
        finalStatus = 'INVALIDATED';
      } else if (counts.validatedControls > 0 && counts.validatedTransitions > 0) {
        finalStatus = 'VALIDATED';
      }

      const statesNotObserved = JSON.parse(reg.states_not_observed_json) as string[];

      db.prepare(
        `UPDATE registry_versions
         SET status = ?, coverage_summary_json = ?
         WHERE registry_version = ?`
      ).run(finalStatus, JSON.stringify(counts), params.registryVersion);

      const sanitizedReportJson = this.redactor.sanitizeToJson({
        registryVersion: params.registryVersion,
        scopeId: reg.scope_id,
        status: finalStatus,
        accountDigest: sha256Hex(params.currentContext.accountContextId),
        projectDigest: sha256Hex(params.currentContext.projectContextId),
        counts,
        statesNotObserved,
        driftDetected: driftResult.driftDetected,
      });

      return {
        registryVersion: params.registryVersion,
        scopeId: reg.scope_id,
        status: finalStatus,
        counts,
        statesNotObserved,
        driftResult,
        sanitizedReportJson,
      };
    });
  }
}
