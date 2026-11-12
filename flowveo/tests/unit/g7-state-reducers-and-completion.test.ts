import { describe, expect, it } from 'vitest';
import {
  evaluateJobCompletionStatus,
  reduceRemoteResultStatus,
  reduceSubmissionIntentStatus,
} from '../../src/execution/state-reducers.js';

describe('Gate G7 — Unit: State Reducers & CompletionPolicy (§11, §12, BC-11, BC-12)', () => {
  it('proibe transitar SubmissionIntent de DISPATCHING ou UNKNOWN para ABORTED ou PLANNED', () => {
    expect(reduceSubmissionIntentStatus('PLANNED', 'RESERVED', 'Reserva ok')).toBe('RESERVED');
    expect(reduceSubmissionIntentStatus('RESERVED', 'ABORTED', 'Pre-check falhou')).toBe('ABORTED');
    expect(reduceSubmissionIntentStatus('RESERVED', 'DISPATCHING', 'Enviando')).toBe('DISPATCHING');
    expect(reduceSubmissionIntentStatus('DISPATCHING', 'UNKNOWN', 'Timeout')).toBe('UNKNOWN');

    // Proibido abortar apos DISPATCHING!
    expect(() =>
      reduceSubmissionIntentStatus('DISPATCHING', 'ABORTED', 'Tentar abortar pos-clique')
    ).toThrow(/Transicao ilegal/);

    expect(() =>
      reduceSubmissionIntentStatus('UNKNOWN', 'ABORTED', 'Tentar esquecer incerteza')
    ).toThrow(/Transicao ilegal/);
  });

  it('permite avancar RemoteResult direto de OBSERVED para READY na retomada sem PROCESSING ficticio (BC-12)', () => {
    expect(
      reduceRemoteResultStatus(
        'OBSERVED',
        'READY',
        'Resultado ja encontrado pronto na pagina apos retomada'
      )
    ).toBe('READY');
  });

  it('avalia CompletionPolicy separando COMPLETED de PARTIAL e FAILED (BC-11)', () => {
    const policy = {
      minVerifiedOutputs: 2,
      allowPartial: true,
      technicalRequirements: {
        minSizeBytes: 100_000,
        expectedContainer: 'mp4' as const,
      },
    };

    // 4 de 4 -> COMPLETED
    expect(
      evaluateJobCompletionStatus({
        requestedOutputs: 4,
        verifiedArtifactsCount: 4,
        failedOrRejectedCount: 0,
        policy,
      })
    ).toBe('COMPLETED');

    // 2 de 4 com allowPartial=true -> PARTIAL (jamais COMPLETED!)
    expect(
      evaluateJobCompletionStatus({
        requestedOutputs: 4,
        verifiedArtifactsCount: 2,
        failedOrRejectedCount: 2,
        policy,
      })
    ).toBe('PARTIAL');

    // 1 de 4 (abaixo de minVerifiedOutputs=2) -> FAILED
    expect(
      evaluateJobCompletionStatus({
        requestedOutputs: 4,
        verifiedArtifactsCount: 1,
        failedOrRejectedCount: 3,
        policy,
      })
    ).toBe('FAILED');
  });
});
