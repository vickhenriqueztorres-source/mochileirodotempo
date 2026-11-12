import { describe, expect, it } from 'vitest';
import type { ContextSnapshot, CreationSnapshot } from '../../src/flow/contracts.js';
import { DefaultFlowReader } from '../../src/flow/flow-reader.js';
import { sha256Hex } from '../../src/infrastructure/observability/redactor.js';

const mockCtx: ContextSnapshot = {
  controllerEpoch: 1,
  sessionEpoch: 1,
  pageId: 'page_1',
  url: 'https://labs.google/fx/flow/proj_1',
  locale: 'pt-BR',
  viewport: { width: 1440, height: 900 },
  accountContextId: 'acct_1',
  projectContextId: 'proj_1',
  creationMode: 'text-to-video',
  observedVariant: 'v1',
  observedRevision: 1,
  isAuthenticated: true,
  hasCaptchaOrVerification: false,
  humanInterferenceDetected: false,
};

const mockCreation: CreationSnapshot = {
  selectedModel: 'veo-2',
  selectedAspectRatio: '16:9',
  selectedOutputsCount: 1,
  promptText: '',
  promptDigestSha256: sha256Hex(''),
  uploadReadyFilename: null,
  observedConfigDigest: sha256Hex('cfg'),
  observedRevision: 1,
};

describe('Gate G4 — Chaos: Delayed Hydration & Transient Read Retry With Backoff (§20)', () => {
  it('recupera de 2 falhas transitorias de leitura e falha de forma fechada se exceder maxReadRetries=2', async () => {
    let calls = 0;
    const readerRecoverable = new DefaultFlowReader(
      {
        readLiveContextAndConfig: async () => {
          calls += 1;
          if (calls <= 2) {
            throw new Error('DOM_HYDRATION_IN_PROGRESS');
          }
          return { context: mockCtx, creation: mockCreation };
        },
        inspectResultsPassively: () => ({ isVirtualizedOrPartial: false, items: [] }),
      },
      { maxReadRetries: 2, baseBackoffMs: 1, sleepFn: async () => undefined }
    );

    const snap = await readerRecoverable.inspectContext();
    expect(snap.projectContextId).toBe('proj_1');
    expect(calls).toBe(3); // 1 inicial + 2 retries

    // Agora falha nas 4 chamadas -> estoura o limite maxReadRetries=2
    const readerFailing = new DefaultFlowReader(
      {
        readLiveContextAndConfig: async () => {
          throw new Error('PERSISTENT_DOM_READ_FAILURE');
        },
        inspectResultsPassively: () => ({ isVirtualizedOrPartial: false, items: [] }),
      },
      { maxReadRetries: 2, baseBackoffMs: 1, sleepFn: async () => undefined }
    );

    await expect(readerFailing.inspectContext()).rejects.toThrow('PERSISTENT_DOM_READ_FAILURE');
  });
});
