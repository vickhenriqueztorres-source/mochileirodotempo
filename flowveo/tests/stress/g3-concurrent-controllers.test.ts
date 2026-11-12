import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ControllerLock } from '../../src/infrastructure/browser/controller-lock.js';
import { Redactor } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { PermitStore } from '../../src/safety/permit-store.js';

describe('Gate G3 — Stress: 25 Concurrent Controllers Competing for OS Lock + SQLite Lease (A-05)', () => {
  it('permite que exatamente 1 controlador adquira o lock enquanto 24 sao bloqueados', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g3-stress-'));
    const flowDb = new FlowDatabase(':memory:');
    const eventRepo = new EventRepository(flowDb, new Redactor());
    const permitStore = new PermitStore(flowDb, eventRepo);

    const controllers = Array.from({ length: 25 }, () =>
      new ControllerLock({
        locksDir: tmpDir,
        flowDb,
        eventRepo,
        permitStore,
      })
    );

    try {
      const attempts = controllers.map((ctrl, idx) =>
        Promise.resolve().then(() =>
          ctrl.acquire({
            ownerPid: 50000 + idx,
            isPidAliveFn: () => true,
          })
        )
      );

      const settled = await Promise.allSettled(attempts);
      const winners = settled.filter((s) => s.status === 'fulfilled');
      const losers = settled.filter((s) => s.status === 'rejected');

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(24);
    } finally {
      for (const c of controllers) {
        c.release();
      }
      flowDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
