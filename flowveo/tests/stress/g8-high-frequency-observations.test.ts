import { describe, expect, it } from 'vitest';
import { RemoteReconciler } from '../../src/execution/remote-reconciler.js';
import { sha256Hex } from '../../src/infrastructure/observability/redactor.js';

describe('Gate G8 — Stress: 500 High-Frequency Progressive Remote Observations', () => {
  it('processa 500 snapshots progressivos com listas virtualizadas de forma 100% deterministica', () => {
    const reconciler = new RemoteReconciler();
    const expectedDigest = sha256Hex('prompt de alta frequencia');

    const baseline = {
      capturedAtMs: 1000,
      isVirtualizedOrPartial: true,
      items: Array.from({ length: 10 }, (_, idx) => ({
        remoteExternalId: `old_id_${idx}`,
        remoteAssetId: `old_asset_${idx}`,
        resultIndex: idx,
        status: 'READY' as const,
        promptSnippetDigest: sha256Hex(`old_${idx}`),
        createdAtLabel: '1h ago',
        downloadControlId: `dl_${idx}`,
      })),
    };

    let notObservedCount = 0;
    let ambiguousCount = 0;
    let confirmedCount = 0;

    for (let i = 0; i < 500; i++) {
      // Primeiros 150: ainda nao apareceu item novo
      // 150..299: apareceu card em skeleton sem remoteExternalId na lista virtualizada -> AMBIGUOUS
      // 300..499: card hidratou com remoteExternalId unico estavel -> CONFIRMED
      const newItems =
        i < 150
          ? []
          : i < 300
            ? [
                {
                  remoteExternalId: null,
                  remoteAssetId: null,
                  resultIndex: 0,
                  status: 'PROCESSING' as const,
                  promptSnippetDigest: expectedDigest,
                  createdAtLabel: 'Just now',
                  downloadControlId: null,
                },
              ]
            : [
                {
                  remoteExternalId: 'rgen_hydrated_target_999',
                  remoteAssetId: 'asset_999',
                  resultIndex: 0,
                  status: 'READY' as const,
                  promptSnippetDigest: expectedDigest,
                  createdAtLabel: 'Just now',
                  downloadControlId: 'dl_999',
                },
              ];

      const decision = reconciler.evaluateCorrelation({
        baseline,
        currentObservation: {
          observedAtMs: 1000 + i * 50,
          isVirtualizedOrPartial: true,
          items: [...newItems, ...baseline.items.slice(0, 8)],
        },
        expectedPromptDigest: expectedDigest,
        allowLevel2HomologatedCombinedEvidence: false,
      });

      if (decision.status === 'NOT_OBSERVED') notObservedCount += 1;
      if (decision.status === 'AMBIGUOUS') ambiguousCount += 1;
      if (decision.status === 'CONFIRMED') confirmedCount += 1;
    }

    expect(notObservedCount).toBe(150);
    expect(ambiguousCount).toBe(150);
    expect(confirmedCount).toBe(200);
  });
});
