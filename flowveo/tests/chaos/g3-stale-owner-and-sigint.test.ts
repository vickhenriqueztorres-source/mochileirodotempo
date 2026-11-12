import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ControllerLock } from '../../src/infrastructure/browser/controller-lock.js';
import { Redactor, sha256Hex } from '../../src/infrastructure/observability/redactor.js';
import { FlowDatabase } from '../../src/infrastructure/persistence/database.js';
import { EventRepository } from '../../src/infrastructure/persistence/repositories/event-repository.js';
import { PermitStore } from '../../src/safety/permit-store.js';
import { StopController } from '../../src/safety/stop-controller.js';
import { ControllerBusyError } from '../../src/shared/errors.js';

describe('Gate G3 — Chaos: Stale Heartbeat With Live Process, Dead Owner Takeover & SIGINT Drain (§7, A-19)', () => {
  it('nao permite tomar o controle apenas por heartbeat vencido se o processo anterior ainda estiver vivo (§7)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-g3-chaos-'));
    const flowDb = new FlowDatabase(':memory:');
    const eventRepo = new EventRepository(flowDb, new Redactor());
    const permitStore = new PermitStore(flowDb, eventRepo);

    const lock1 = new ControllerLock({
      locksDir: tmpDir,
      flowDb,
      eventRepo,
      permitStore,
    });
    const lock2 = new ControllerLock({
      locksDir: tmpDir,
      flowDb,
      eventRepo,
      permitStore,
    });

    try {
      const lease1 = lock1.acquire({
        ownerPid: 11111,
        nowMs: 1_000_000,
        isPidAliveFn: () => true,
      });
      expect(lease1.controllerEpoch).toBe(1);

      // Passaram 5 minutos (heartbeat expirado), MAS o PID 11111 continua vivo no SO!
      expect(() =>
        lock2.acquire({
          ownerPid: 22222,
          nowMs: 1_300_000,
          heartbeatTimeoutMs: 30_000,
          allowStaleTakeover: true,
          isPidAliveFn: (pid) => pid === 11111, // PID 11111 ainda vivo!
        })
      ).toThrow(ControllerBusyError);

      // Agora simular que o PID 11111 morreu abruptamente (kill -9):
      // Sem allowStaleTakeover=true, ainda bloqueia na duvida (exige recuperacao explicita)
      expect(() =>
        lock2.acquire({
          ownerPid: 22222,
          nowMs: 1_300_000,
          allowStaleTakeover: false,
          isPidAliveFn: () => false,
        })
      ).toThrow(/Exige recuperacao explicita/);

      // Com recuperacao explicita (allowStaleTakeover=true) e PID morto: assume no epoch 2!
      const lease2 = lock2.acquire({
        ownerPid: 22222,
        nowMs: 1_300_000,
        allowStaleTakeover: true,
        isPidAliveFn: () => false,
      });
      expect(lease2.controllerEpoch).toBe(2);
    } finally {
      lock2.release();
      flowDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('drena e revoga permissoes em voo ao receber SIGINT (Ctrl+C) no StopController (A-19)', () => {
    const flowDb = new FlowDatabase(':memory:');
    const eventRepo = new EventRepository(flowDb, new Redactor());
    const permitStore = new PermitStore(flowDb, eventRepo);
    const stopController = new StopController(permitStore);

    try {
      const permit = permitStore.issuePermit(
        {
          planId: 'plan_sigint',
          mode: 'explore',
          actionKind: 'OPEN_UI',
          targetControlId: 'ctrl_1',
          transitionId: 'tr_1',
          paramsCanonical: {},
          paramsDigestSha256: sha256Hex('{}'),
          projectContextId: 'proj_1',
          accountContextId: 'acct_1',
          registryVersion: 'reg_1',
          policyVersion: '1.0.0',
          observedConfigDigest: sha256Hex('cfg'),
          observedRevision: 1,
        },
        {
          controllerEpoch: 1,
          sessionEpoch: 1,
          pageId: 'page_1',
          ttlMs: 15000,
        }
      );

      const status = stopController.requestStop('SIGINT', 1);
      expect(status.stopRequested).toBe(true);
      expect(status.drained).toBe(true);
      expect(() => stopController.assertNotStopped()).toThrow(/parada em andamento/);
      expect(permitStore.getPermitAndPlan(permit.permitId).permit.status).toBe('REVOKED');
    } finally {
      flowDb.close();
    }
  });
});
