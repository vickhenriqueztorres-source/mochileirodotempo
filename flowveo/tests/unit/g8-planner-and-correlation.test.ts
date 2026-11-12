import { describe, expect, it } from 'vitest';
import { RemoteReconciler } from '../../src/execution/remote-reconciler.js';
import { DefaultActionPlanner, computeObservedConfigDigest } from '../../src/flow/action-planner.js';
import { sha256Hex } from '../../src/infrastructure/observability/redactor.js';

describe('Gate G8 — Unit: ActionPlanner & RemoteReconciler Correlation Rules (§14 / BC-08)', () => {
  it('gera ActionPlan deterministico independentemente da ordem das chaves em paramsCanonical', () => {
    const planner = new DefaultActionPlanner();
    const digest = computeObservedConfigDigest({
      projectContextId: 'proj_1',
      model: 'veo-2',
      aspectRatio: '16:9',
      requestedOutputs: 2,
      promptDigestSha256: sha256Hex('prompt'),
    });

    const ctx = {
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
      observedRevision: 10,
      isAuthenticated: true,
      hasCaptchaOrVerification: false,
      humanInterferenceDetected: false,
    };

    const plan1 = planner.plan(
      {
        mode: 'execute',
        actionKind: 'CONFIGURE',
        targetControlId: 'ctrl_1',
        transitionId: 'tr_1',
        paramsCanonical: { b: 2, a: 1 },
        registryVersion: 'reg_1',
        policyVersion: '1.0.0',
        observedConfigDigest: digest,
      },
      ctx
    );

    const plan2 = planner.plan(
      {
        mode: 'execute',
        actionKind: 'CONFIGURE',
        targetControlId: 'ctrl_1',
        transitionId: 'tr_1',
        paramsCanonical: { a: 1, b: 2 },
        registryVersion: 'reg_1',
        policyVersion: '1.0.0',
        observedConfigDigest: digest,
      },
      ctx
    );

    expect(plan1.paramsDigestSha256).toBe(plan2.paramsDigestSha256);
  });

  it('JAMAIS retorna CONFIRMED quando apenas prompt igual, apenas posicao #1 ou apenas timestamp proximo estao presentes isoladamente', () => {
    const reconciler = new RemoteReconciler();
    const promptDigest = sha256Hex('prompt oficial do job');

    // Caso 1: Apenas prompt igual (sem ID remoto estavel, sem timestamp/asset combinados)
    const promptOnly = reconciler.evaluateCorrelation({
      baseline: { capturedAtMs: 1000, isVirtualizedOrPartial: false, items: [] },
      currentObservation: {
        observedAtMs: 2000,
        isVirtualizedOrPartial: false,
        items: [
          {
            remoteExternalId: null,
            remoteAssetId: null,
            resultIndex: 0,
            status: 'PROCESSING',
            promptSnippetDigest: promptDigest,
            createdAtLabel: null,
            downloadControlId: null,
          },
        ],
      },
      expectedPromptDigest: promptDigest,
      allowLevel2HomologatedCombinedEvidence: true,
    });
    expect(promptOnly.status).toBe('AMBIGUOUS');

    // Caso 2: Apenas posicao #0 na lista (sem prompt e sem ID estavel)
    const positionOnly = reconciler.evaluateCorrelation({
      baseline: { capturedAtMs: 1000, isVirtualizedOrPartial: false, items: [] },
      currentObservation: {
        observedAtMs: 2000,
        isVirtualizedOrPartial: false,
        items: [
          {
            remoteExternalId: null,
            remoteAssetId: 'asset_1',
            resultIndex: 0,
            status: 'PROCESSING',
            promptSnippetDigest: null,
            createdAtLabel: null,
            downloadControlId: null,
          },
        ],
      },
      expectedPromptDigest: promptDigest,
      allowLevel2HomologatedCombinedEvidence: true,
    });
    expect(positionOnly.status).toBe('AMBIGUOUS');

    // Caso 3: Apenas horario proximo isolado
    const timeOnly = reconciler.evaluateCorrelation({
      baseline: { capturedAtMs: 1000, isVirtualizedOrPartial: false, items: [] },
      currentObservation: {
        observedAtMs: 2000,
        isVirtualizedOrPartial: false,
        items: [
          {
            remoteExternalId: null,
            remoteAssetId: 'asset_1',
            resultIndex: 0,
            status: 'PROCESSING',
            promptSnippetDigest: null,
            createdAtLabel: 'Just now',
            downloadControlId: null,
          },
        ],
      },
      expectedPromptDigest: promptDigest,
      allowLevel2HomologatedCombinedEvidence: true,
    });
    expect(timeOnly.status).toBe('AMBIGUOUS');
  });

  it('retorna AMBIGUOUS / requiresOperatorReview quando a lista e virtualizada/parcial e nao ha ID remoto estavel', () => {
    const reconciler = new RemoteReconciler();
    const promptDigest = sha256Hex('prompt oficial');

    const decision = reconciler.evaluateCorrelation({
      baseline: { capturedAtMs: 1000, isVirtualizedOrPartial: true, items: [] },
      currentObservation: {
        observedAtMs: 2000,
        isVirtualizedOrPartial: true,
        items: [
          {
            remoteExternalId: null,
            remoteAssetId: 'asset_99',
            resultIndex: 0,
            status: 'READY',
            promptSnippetDigest: promptDigest,
            createdAtLabel: 'Just now',
            downloadControlId: 'dl_99',
          },
        ],
      },
      expectedPromptDigest: promptDigest,
      allowLevel2HomologatedCombinedEvidence: true,
    });

    expect(decision.status).toBe('AMBIGUOUS');
    expect(decision.requiresOperatorReview).toBe(true);
    expect(decision.ruleApplied).toBe('VIRTUALIZED_OR_PARTIAL_LIST_WITHOUT_STABLE_ID');
  });

  it('retorna CONFIRMED para Nivel 1 (ID remoto estavel) e Nivel 2 (evidencia combinada homologada em lista completa)', () => {
    const reconciler = new RemoteReconciler();
    const promptDigest = sha256Hex('prompt oficial');

    const level1 = reconciler.evaluateCorrelation({
      baseline: { capturedAtMs: 1000, isVirtualizedOrPartial: true, items: [] },
      currentObservation: {
        observedAtMs: 2000,
        isVirtualizedOrPartial: true,
        items: [
          {
            remoteExternalId: 'rgen_stable_123',
            remoteAssetId: 'asset_123',
            resultIndex: 0,
            status: 'PROCESSING',
            promptSnippetDigest: promptDigest,
            createdAtLabel: 'Just now',
            downloadControlId: null,
          },
        ],
      },
      expectedPromptDigest: promptDigest,
      allowLevel2HomologatedCombinedEvidence: false,
    });

    expect(level1.status).toBe('CONFIRMED');
    expect(level1.confidenceLevel).toBe('LEVEL_1_STABLE_ID');
    expect(level1.matchedRemoteExternalId).toBe('rgen_stable_123');

    const level2 = reconciler.evaluateCorrelation({
      baseline: { capturedAtMs: 1000, isVirtualizedOrPartial: false, items: [] },
      currentObservation: {
        observedAtMs: 2000,
        isVirtualizedOrPartial: false,
        items: [
          {
            remoteExternalId: null,
            remoteAssetId: 'asset_comb_456',
            resultIndex: 0,
            status: 'PROCESSING',
            promptSnippetDigest: promptDigest,
            createdAtLabel: 'Just now',
            downloadControlId: null,
          },
        ],
      },
      expectedPromptDigest: promptDigest,
      allowLevel2HomologatedCombinedEvidence: true,
    });

    expect(level2.status).toBe('CONFIRMED');
    expect(level2.confidenceLevel).toBe('LEVEL_2_COMBINED_EVIDENCE');
    expect(level2.matchedRemoteExternalId).toBe('asset_comb_456');
  });
});
