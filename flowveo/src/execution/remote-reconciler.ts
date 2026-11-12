import type { CorrelationStatus } from '../domain/submissions/submission-types.js';
import type { ResultObservation } from '../flow/contracts.js';

export interface BaselineCapture {
  capturedAtMs: number;
  isVirtualizedOrPartial: boolean;
  items: ResultObservation[];
}

export interface CorrelationEvaluationInput {
  baseline: BaselineCapture;
  currentObservation: {
    observedAtMs: number;
    isVirtualizedOrPartial: boolean;
    items: ResultObservation[];
  };
  expectedPromptDigest: string;
  /**
   * Indica se as evidencias combinadas de Nivel 2 foram homologadas para a versao atual do mapa
   * e se todas as alternativas concorrentes foram comprovadamente excluidas.
   */
  allowLevel2HomologatedCombinedEvidence: boolean;
}

export interface CorrelationDecision {
  status: CorrelationStatus;
  confidenceLevel: 'LEVEL_1_STABLE_ID' | 'LEVEL_2_COMBINED_EVIDENCE' | 'NONE';
  matchedRemoteExternalId: string | null;
  candidateCount: number;
  ruleApplied: string;
  requiresOperatorReview: boolean;
}

/**
 * RemoteReconciler / CorrelationEngine (Arquitetura §14 / BC-08):
 * Ordem estrita de confianca:
 * - Nivel 1 (CONFIRMED): Identificador remoto estavel observado no evento/card criado apos o envio e ausente no baseline.
 * - Nivel 2 (CONFIRMED): Combinacao homologada de evidencias (novo item unico surgido apos baseline completo +
 *   parametros/prompt/timestamp compativeis + exclusao comprovada de alternativas).
 * - AMBIGUOUS (vai para NEEDS_REVIEW): 2+ resultados candidatos compativeis (geracao manual concorrente / cards identicos)
 *   ou listagem parcial/virtualizada sem ID remoto estavel.
 * - NOT_OBSERVED: Nenhum item novo visivel ainda.
 *
 * REGRA CRITICA (§14): Prompt, posicao na lista ou horario ISOLADAMENTE nunca produzem CONFIRMED.
 */
export class RemoteReconciler {
  public evaluateCorrelation(input: CorrelationEvaluationInput): CorrelationDecision {
    const baselineExternalIds = new Set(
      input.baseline.items
        .map((i) => i.remoteExternalId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    );
    const baselineAssetIds = new Set(
      input.baseline.items
        .map((i) => i.remoteAssetId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    );

    // 1. Filtrar itens que surgiram apos o baseline
    const newItems = input.currentObservation.items.filter((item) => {
      if (item.remoteExternalId && baselineExternalIds.has(item.remoteExternalId)) {
        return false;
      }
      if (item.remoteAssetId && baselineAssetIds.has(item.remoteAssetId)) {
        return false;
      }
      // Se nao possui ID estavel, so faz parte do baseline se ja existia item sem ID no mesmo indice e mesmo digest
      if (!item.remoteExternalId && !item.remoteAssetId) {
        const existedInBaseline = input.baseline.items.some(
          (b) =>
            b.resultIndex === item.resultIndex &&
            !b.remoteExternalId &&
            !b.remoteAssetId &&
            b.promptSnippetDigest === item.promptSnippetDigest
        );
        return !existedInBaseline;
      }
      return true;
    });

    if (newItems.length === 0) {
      return {
        status: 'NOT_OBSERVED',
        confidenceLevel: 'NONE',
        matchedRemoteExternalId: null,
        candidateCount: 0,
        ruleApplied: 'NO_NEW_ITEMS_AFTER_BASELINE',
        requiresOperatorReview: false,
      };
    }

    // 2. Avaliar candidatos com ID remoto estavel (Nivel 1), agrupados por remoteExternalId distinto
    // (pois 1 submissao com N outputs gera N itens com o MESMO remoteExternalId!)
    const stableIdCandidates = newItems.filter(
      (item) => typeof item.remoteExternalId === 'string' && item.remoteExternalId.trim().length > 0
    );
    const distinctExternalIds = Array.from(
      new Set(stableIdCandidates.map((c) => c.remoteExternalId as string))
    );

    // Se existem 2+ IDs de submissao distintos compativeis (ex.: geracao manual concorrente na mesma conta),
    // e AMBIGUOUS a menos que apenas 1 ID tenha o promptDigest exato e os demais tenham promptDigest diferente.
    if (distinctExternalIds.length > 1) {
      const matchingExternalIds = Array.from(
        new Set(
          stableIdCandidates
            .filter((c) => c.promptSnippetDigest === input.expectedPromptDigest)
            .map((c) => c.remoteExternalId as string)
        )
      );
      if (matchingExternalIds.length === 1) {
        return {
          status: 'CONFIRMED',
          confidenceLevel: 'LEVEL_1_STABLE_ID',
          matchedRemoteExternalId: matchingExternalIds[0]!,
          candidateCount: 1,
          ruleApplied: 'LEVEL_1_UNIQUE_STABLE_ID_WITH_PROMPT_EXCLUSION',
          requiresOperatorReview: false,
        };
      }
      return {
        status: 'AMBIGUOUS',
        confidenceLevel: 'NONE',
        matchedRemoteExternalId: null,
        candidateCount: distinctExternalIds.length,
        ruleApplied: 'MULTIPLE_CONCURRENT_CANDIDATES_AMBIGUOUS',
        requiresOperatorReview: true,
      };
    }

    if (distinctExternalIds.length === 1) {
      const candidate = stableIdCandidates[0]!;
      // Se o card expoe promptSnippetDigest e ele diverge do prompt enviado, nao pode confirmar!
      if (
        candidate.promptSnippetDigest !== null &&
        candidate.promptSnippetDigest !== input.expectedPromptDigest
      ) {
        return {
          status: 'AMBIGUOUS',
          confidenceLevel: 'NONE',
          matchedRemoteExternalId: null,
          candidateCount: 1,
          ruleApplied: 'STABLE_ID_PROMPT_DIGEST_MISMATCH',
          requiresOperatorReview: true,
        };
      }

      return {
        status: 'CONFIRMED',
        confidenceLevel: 'LEVEL_1_STABLE_ID',
        matchedRemoteExternalId: distinctExternalIds[0]!,
        candidateCount: 1,
        ruleApplied: 'LEVEL_1_UNIQUE_STABLE_REMOTE_ID',
        requiresOperatorReview: false,
      };
    }

    // 3. Sem ID remoto estavel (apenas observacoes posicionais/textuais/temporais)
    // Regra critica (§14): Se o baseline ou observacao atual for virtualizado/parcial, sem ID remoto estavel -> AMBIGUOUS!
    if (
      input.baseline.isVirtualizedOrPartial ||
      input.currentObservation.isVirtualizedOrPartial
    ) {
      return {
        status: 'AMBIGUOUS',
        confidenceLevel: 'NONE',
        matchedRemoteExternalId: null,
        candidateCount: newItems.length,
        ruleApplied: 'VIRTUALIZED_OR_PARTIAL_LIST_WITHOUT_STABLE_ID',
        requiresOperatorReview: true,
      };
    }

    // Se surgiram 2+ itens sem ID estavel -> AMBIGUOUS
    if (newItems.length > 1) {
      return {
        status: 'AMBIGUOUS',
        confidenceLevel: 'NONE',
        matchedRemoteExternalId: null,
        candidateCount: newItems.length,
        ruleApplied: 'MULTIPLE_UNIDENTIFIED_NEW_ITEMS',
        requiresOperatorReview: true,
      };
    }

    const singleNew = newItems[0]!;

    // Regra critica (§14): Prompt, posicao na lista ou horario ISOLADAMENTE nunca produzem CONFIRMED.
    // Para Nivel 2, exige:
    // - allowLevel2HomologatedCombinedEvidence === true
    // - promptSnippetDigest presente e igual ao esperado
    // - createdAtLabel presente (evidencia temporal combinada)
    // - remoteAssetId presente para rastreio subsequente
    const hasPromptMatch =
      singleNew.promptSnippetDigest !== null &&
      singleNew.promptSnippetDigest === input.expectedPromptDigest;
    const hasTimestampEvidence =
      singleNew.createdAtLabel !== null && singleNew.createdAtLabel.trim().length > 0;
    const hasAssetAnchor =
      singleNew.remoteAssetId !== null && singleNew.remoteAssetId.trim().length > 0;

    if (
      input.allowLevel2HomologatedCombinedEvidence &&
      hasPromptMatch &&
      hasTimestampEvidence &&
      hasAssetAnchor
    ) {
      return {
        status: 'CONFIRMED',
        confidenceLevel: 'LEVEL_2_COMBINED_EVIDENCE',
        matchedRemoteExternalId: singleNew.remoteAssetId,
        candidateCount: 1,
        ruleApplied: 'LEVEL_2_COMBINED_COMPLETE_BASELINE_PROMPT_TIME_ASSET',
        requiresOperatorReview: false,
      };
    }

    return {
      status: 'AMBIGUOUS',
      confidenceLevel: 'NONE',
      matchedRemoteExternalId: null,
      candidateCount: 1,
      ruleApplied: 'INSUFFICIENT_ISOLATED_EVIDENCE_PROMPT_POSITION_OR_TIME_ALONE',
      requiresOperatorReview: true,
    };
  }
}
