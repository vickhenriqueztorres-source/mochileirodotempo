import { describe, expect, it } from 'vitest';
import { Redactor } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { MutationBlockedError, PersistenceFailureError } from '../../src/shared/errors.js';

describe('Gate G1 — Chaos: SQLite Disk Full, Busy, Rollback Atomicity & Mutation Block (S-06)', () => {
  it('faz rollback atomico (estado + evento) quando ocorre falha no meio da transacao', () => {
    const flowDb = new FlowDatabase(':memory:');
    const redactor = new Redactor();
    const eventRepo = new EventRepository(flowDb, redactor);

    try {
      expect(() =>
        flowDb.writeTransaction((db) => {
          db.prepare(
            `INSERT INTO policy_versions (policy_version, release_phase, config_json, digest_sha256, created_at)
             VALUES ('1.0.0', 'A', '{}', 'abc', ?)`
          ).run(new Date().toISOString());

          eventRepo.insertWithinTransaction(db, {
            eventType: 'system.preflight',
            correlationId: 'corr_chaos_1',
            controllerEpoch: 1,
            policyVersion: '1.0.0',
            registryVersion: 'reg_0',
            reason: 'Antes do crash',
          });

          // Simular erro de disco cheio antes do COMMIT
          throw new Error('SQLITE_FULL: database or disk is full');
        })
      ).toThrow(PersistenceFailureError);

      // Nem a policy_version nem o evento podem ter sido persistidos!
      const countPolicies = flowDb.read((db) =>
        db.prepare('SELECT COUNT(*) as c FROM policy_versions').get() as { c: number }
      );
      expect(countPolicies.c).toBe(0);
      expect(eventRepo.listEvents()).toHaveLength(0);

      // E futuras mutacoes devem estar bloqueadas (S-06)
      expect(flowDb.isMutationBlocked()).toBe(true);
      expect(() =>
        flowDb.writeTransaction((db) => {
          db.prepare('DELETE FROM policy_versions').run();
        })
      ).toThrow(MutationBlockedError);
    } finally {
      flowDb.close();
    }
  });

  it('bloqueia mutacoes imediatamente quando fault DISK_FULL ou SQLITE_BUSY e injetado', () => {
    const flowDb = new FlowDatabase(':memory:');
    try {
      flowDb.injectFaultForTesting('DISK_FULL');
      expect(() =>
        flowDb.writeTransaction((db) => {
          db.prepare('SELECT 1').get();
        })
      ).toThrow(PersistenceFailureError);

      expect(flowDb.isMutationBlocked()).toBe(true);
      expect(flowDb.getMutationBlockReason()).toContain('DISK_FULL');

      // Mesmo limpando o fault injetado, o banco permanece em estado seguro bloqueado ate intervencao/restart
      flowDb.injectFaultForTesting('NONE');
      expect(() =>
        flowDb.writeTransaction((db) => {
          db.prepare('SELECT 1').get();
        })
      ).toThrow(MutationBlockedError);
    } finally {
      flowDb.close();
    }
  });
});
