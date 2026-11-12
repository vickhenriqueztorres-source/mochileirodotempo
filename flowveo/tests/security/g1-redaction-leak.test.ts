import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EvidenceRecorder, StructuredLogger } from '../../src/infrastructure/observability/logger.js';
import { Redactor } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { SanitizationFailureError } from '../../src/shared/errors.js';

describe('Gate G1 — Security: Zero Secret Leakage & Fail-Closed Sanitization (S-07)', () => {
  it('remove cookies, Bearer tokens, JWTs, storageState e resume prompts por digest SHA-256', () => {
    const redactor = new Redactor();
    const rawPayload = {
      url: 'https://labs.google/fx/flow?token=ya29.a0AfH6SMBx999&api_key=AIzaSySecret123',
      headers: {
        Authorization: 'Bearer ya29.a0AfH6SMB_SUPER_SECRET_TOKEN',
        Cookie: '__Secure-1PSID=cookie_val_987654; SID=sid_secret_111',
      },
      storageState: {
        cookies: [{ name: 'SID', value: 'raw_cookie_secret' }],
      },
      prompt: 'Crie um video pessoal do CPF 123.456.789-00 na rua X',
      nestedNote: 'Token vazado no texto: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    };

    const json = redactor.sanitizeToJson(rawPayload);

    expect(json).not.toContain('ya29.a0AfH6SMBx999');
    expect(json).not.toContain('AIzaSySecret123');
    expect(json).not.toContain('ya29.a0AfH6SMB_SUPER_SECRET_TOKEN');
    expect(json).not.toContain('cookie_val_987654');
    expect(json).not.toContain('raw_cookie_secret');
    expect(json).not.toContain('123.456.789-00');
    expect(json).not.toContain('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
    expect(json).toContain('digestSha256');
    expect(json).toContain('[REDACTED_SECRET]');
  });

  it('descarta evidencia e nao salva arquivo bruto nem evento quando a sanitizacao falha (Arquitetura §19)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g1-sec-'));
    const flowDb = new FlowDatabase(':memory:');
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);
    const evidenceDir = path.join(tmpDir, 'evidence');
    const recorder = new EvidenceRecorder(redactor, eventRepo, evidenceDir);

    try {
      // Caso 1: Objeto com referencia circular que falha na sanitizacao
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;

      expect(() =>
        recorder.recordEvidenceAndEvent(
          {
            eventType: 'action.observed',
            correlationId: 'corr_1',
            controllerEpoch: 1,
            policyVersion: '1.0.0',
            registryVersion: 'reg_1',
            reason: 'Teste circular',
          },
          circular
        )
      ).toThrow(SanitizationFailureError);

      expect(fs.readdirSync(evidenceDir)).toHaveLength(0);
      expect(eventRepo.listEvents()).toHaveLength(0);

      // Caso 2: Falha forcada no Redactor
      redactor.setForceFailForTesting(true);
      expect(() =>
        recorder.recordEvidenceAndEvent(
          {
            eventType: 'action.observed',
            correlationId: 'corr_2',
            controllerEpoch: 1,
            policyVersion: '1.0.0',
            registryVersion: 'reg_1',
            reason: 'Teste falha forcada',
          },
          { safe: 'data' }
        )
      ).toThrow(SanitizationFailureError);

      expect(fs.readdirSync(evidenceDir)).toHaveLength(0);
      expect(eventRepo.listEvents()).toHaveLength(0);

      // Logger tambem nunca vaza segredo
      redactor.setForceFailForTesting(false);
      const logger = new StructuredLogger(redactor);
      const line = logger.info('Header Cookie: SID=secret_99999', {
        apiKey: 'my_secret_api_key',
      });
      expect(line).not.toContain('secret_99999');
      expect(line).not.toContain('my_secret_api_key');
    } finally {
      flowDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
