import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FlowDatabase } from '../persistence/database.js';
import { EventRepository } from '../persistence/repositories/event-repository.js';
import { PermitStore } from '../../safety/permit-store.js';
import { ControllerBusyError } from '../../shared/errors.js';

export interface LockFilePayload {
  leaseId: string;
  controllerEpoch: number;
  ownerPid: number;
  ownerHost: string;
  acquiredAt: string;
}

export interface AcquireLockOptions {
  ownerPid?: number;
  ownerHost?: string;
  allowStaleTakeover?: boolean;
  heartbeatTimeoutMs?: number;
  nowMs?: number;
  isPidAliveFn?: (pid: number) => boolean;
}

export function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM significa que o processo existe mas pertence a outro usuario
    return code === 'EPERM';
  }
}

export class ControllerLock {
  private readonly locksDir: string;
  private readonly lockFilePath: string;
  private readonly flowDb: FlowDatabase;
  private readonly eventRepo: EventRepository;
  private readonly permitStore: PermitStore;
  private activeLease: LockFilePayload | null = null;

  constructor(params: {
    locksDir: string;
    flowDb: FlowDatabase;
    eventRepo: EventRepository;
    permitStore: PermitStore;
  }) {
    this.locksDir = params.locksDir;
    fs.mkdirSync(this.locksDir, { recursive: true });
    this.lockFilePath = path.join(this.locksDir, 'controller.lock.json');
    this.flowDb = params.flowDb;
    this.eventRepo = params.eventRepo;
    this.permitStore = params.permitStore;
  }

  public acquire(options?: AcquireLockOptions): LockFilePayload {
    const ownerPid = options?.ownerPid ?? process.pid;
    const ownerHost = options?.ownerHost ?? os.hostname();
    const allowStaleTakeover = options?.allowStaleTakeover ?? false;
    const heartbeatTimeoutMs = options?.heartbeatTimeoutMs ?? 30_000;
    const nowMs = options?.nowMs ?? Date.now();
    const isPidAlive = options?.isPidAliveFn ?? defaultIsPidAlive;

    // 1. Verificar se existe lease ACTIVE no banco ou lockfile no SO
    const existingActiveLease = this.flowDb.read((db) =>
      db
        .prepare(
          `SELECT lease_id, controller_epoch, owner_pid, owner_host, heartbeat_at
           FROM controller_leases WHERE status = 'ACTIVE' ORDER BY controller_epoch DESC LIMIT 1`
        )
        .get() as
        | {
            lease_id: string;
            controller_epoch: number;
            owner_pid: number;
            owner_host: string;
            heartbeat_at: string;
          }
        | undefined
    );

    const lockFileExists = fs.existsSync(this.lockFilePath);

    if (existingActiveLease || lockFileExists) {
      let existingPid = existingActiveLease?.owner_pid;
      if (!existingPid && lockFileExists) {
        try {
          const parsed = JSON.parse(fs.readFileSync(this.lockFilePath, 'utf-8')) as LockFilePayload;
          existingPid = parsed.ownerPid;
        } catch {
          existingPid = undefined;
        }
      }

      const pidStillRunning = existingPid !== undefined ? isPidAlive(existingPid) : false;
      const heartbeatAgeMs = existingActiveLease
        ? nowMs - new Date(existingActiveLease.heartbeat_at).getTime()
        : Number.MAX_SAFE_INTEGER;
      const isHeartbeatExpired = heartbeatAgeMs > heartbeatTimeoutMs;

      // Regra Arquitetura §7: Heartbeat vencido NAO basta para tomar controle se o processo anterior estiver vivo!
      if (pidStillRunning) {
        throw new ControllerBusyError(
          `Outro controlador esta ativo (PID=${existingPid}, heartbeatExpired=${isHeartbeatExpired}). Dois controladores nao operam juntos (A-05).`,
          { existingPid, isHeartbeatExpired }
        );
      }

      // Mesmo com PID morto, na duvida exigir recuperacao explicita (allowStaleTakeover)
      if (!allowStaleTakeover) {
        throw new ControllerBusyError(
          `Lock orfao detectado do PID inativo ${existingPid}. Exige recuperacao explicita (allowStaleTakeover=true) para assumir ownership (Arquitetura §7).`,
          { existingPid, stale: true }
        );
      }

      // Limpar lockfile antigo para permitir escrita atomica 'wx' do novo epoch
      fs.rmSync(this.lockFilePath, { force: true });
    }

    // 2. Criar lockfile primario do SO com flag 'wx' (falha se criado concorrentemente no mesmo instante)
    let fd: number;
    try {
      fd = fs.openSync(this.lockFilePath, 'wx', 0o600);
    } catch (err) {
      throw new ControllerBusyError(
        'Falha ao adquirir lockfile exclusivo do SO (disputa concorrente detectada — A-05).',
        { error: err instanceof Error ? err.message : String(err) }
      );
    }

    try {
      const lease = this.flowDb.writeTransaction((db) => {
        // Revogar quaisquer leases anteriores que tenham ficado ACTIVE
        db.prepare(
          `UPDATE controller_leases
           SET status = 'REVOKED', released_at = ?
           WHERE status = 'ACTIVE'`
        ).run(new Date(nowMs).toISOString());

        const maxRow = db
          .prepare('SELECT COALESCE(MAX(controller_epoch), 0) as max_epoch FROM controller_leases')
          .get() as { max_epoch: number };
        const nextEpoch = Number(maxRow.max_epoch) + 1;
        const leaseId = `lse_${crypto.randomUUID()}`;
        const isoNow = new Date(nowMs).toISOString();

        db.prepare(
          `INSERT INTO controller_leases (
            lease_id, controller_epoch, owner_pid, owner_host,
            session_epoch, status, acquired_at, heartbeat_at
          ) VALUES (?, ?, ?, ?, 1, 'ACTIVE', ?, ?)`
        ).run(leaseId, nextEpoch, ownerPid, ownerHost, isoNow, isoNow);

        this.eventRepo.insertWithinTransaction(db, {
          eventType: 'controller.acquired',
          correlationId: leaseId,
          controllerEpoch: nextEpoch,
          policyVersion: '1.0.0',
          registryVersion: 'BOOTSTRAP',
          reason: `Ownership adquirido por PID ${ownerPid} no epoch ${nextEpoch}`,
          payload: { leaseId, controllerEpoch: nextEpoch, ownerPid, allowStaleTakeover },
        });

        return {
          leaseId,
          controllerEpoch: nextEpoch,
          ownerPid,
          ownerHost,
          acquiredAt: isoNow,
        };
      });

      // Revogar permissoes de epochs anteriores (Arquitetura §7 e §10)
      this.permitStore.revokeAllInFlightPermitsOnStartup(
        lease.controllerEpoch,
        `Novo controllerEpoch=${lease.controllerEpoch} assumiu ownership`
      );

      fs.writeFileSync(fd, JSON.stringify(lease, null, 2), 'utf-8');
      fs.closeSync(fd);
      this.activeLease = lease;
      return lease;
    } catch (err) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
      fs.rmSync(this.lockFilePath, { force: true });
      throw err;
    }
  }

  public heartbeat(nowMs?: number): void {
    if (!this.activeLease) {
      throw new ControllerBusyError('Nenhum lease ativo neste controlador para enviar heartbeat.');
    }
    const iso = new Date(nowMs ?? Date.now()).toISOString();
    const epoch = this.activeLease.controllerEpoch;
    this.flowDb.writeTransaction((db) => {
      const res = db
        .prepare(
          `UPDATE controller_leases
           SET heartbeat_at = ?
           WHERE controller_epoch = ? AND status = 'ACTIVE'`
        )
        .run(iso, epoch);
      if (res.changes !== 1) {
        throw new ControllerBusyError(`Lease do epoch ${epoch} foi perdido ou revogado.`);
      }
    });
  }

  public release(): void {
    if (!this.activeLease) return;
    const lease = this.activeLease;
    this.activeLease = null;
    this.flowDb.writeTransaction((db) => {
      db.prepare(
        `UPDATE controller_leases
         SET status = 'RELEASED', released_at = ?
         WHERE controller_epoch = ? AND status = 'ACTIVE'`
      ).run(new Date().toISOString(), lease.controllerEpoch);
    });
    fs.rmSync(this.lockFilePath, { force: true });
  }

  public getActiveLease(): LockFilePayload | null {
    return this.activeLease;
  }
}
