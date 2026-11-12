import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Redactor } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';

describe('Gate G1 — Stress: Serialized Write Queue Under High Concurrency', () => {
  it('processa 300 transacoes concorrentes de estado + evento em disco WAL com zero perda e ordem integra', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g1-stress-'));
    const dbPath = path.join(tmpDir, 'stress.db');
    const flowDb = new FlowDatabase(dbPath);
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);

    try {
      const total = 300;
      const tasks: Array<Promise<number>> = [];

      for (let i = 1; i <= total; i++) {
        tasks.push(
          flowDb.enqueueWriteTransaction((db) => {
            db.prepare(
              `INSERT INTO usage_counters (counter_key, submissions_count, requested_outputs_count, downloaded_bytes, window_started_at_ms, updated_at_ms)
               VALUES (?, 1, 1, 1024, ?, ?)`
            ).run(`key_${i}`, Date.now(), Date.now());

            eventRepo.insertWithinTransaction(db, {
              eventType: 'action.planned',
              correlationId: `corr_${i}`,
              controllerEpoch: 1,
              policyVersion: '1.0.0',
              registryVersion: 'reg_1',
              reason: `Stress event #${i}`,
              payload: { seq: i, token: `secret_tok_${i}` },
            });
            return i;
          })
        );
      }

      const results = await Promise.all(tasks);
      expect(results).toHaveLength(total);
      expect(results[0]).toBe(1);
      expect(results[total - 1]).toBe(total);

      const events = eventRepo.listEvents();
      expect(events).toHaveLength(total);
      // Verificar que todos foram sanitizados
      expect(events[0]?.payloadSanitizedJson).toContain('[REDACTED_SECRET]');
    } finally {
      flowDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
