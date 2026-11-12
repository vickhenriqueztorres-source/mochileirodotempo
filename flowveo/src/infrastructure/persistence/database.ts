import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import {
  FlowAutomationError,
  MutationBlockedError,
  PersistenceFailureError,
} from '../../shared/errors.js';

const requireSqlite = createRequire(import.meta.url);
const { DatabaseSync } = requireSqlite('node:sqlite') as {
  DatabaseSync: new (location: string) => DatabaseSyncType;
};

export interface PragmaStatus {
  journalMode: string;
  synchronous: number;
  foreignKeys: number;
  busyTimeout: number;
}

export class FlowDatabase {
  private readonly db: DatabaseSyncType;
  private readonly dbPath: string;
  private mutationBlocked = false;
  private mutationBlockReason: string | null = null;
  private simulatedFault: 'NONE' | 'DISK_FULL' | 'IO_ERROR' | 'SQLITE_BUSY' = 'NONE';
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(dbPath: string, migrationsDir?: string) {
    this.dbPath = dbPath;
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      fs.mkdirSync(dir, { recursive: true });
      // Backup antes de migracao se o arquivo ja existir e tiver dados (Arquitetura §15)
      if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
        const backupPath = `${dbPath}.bak`;
        fs.copyFileSync(dbPath, backupPath);
      }
    }

    this.db = new DatabaseSync(dbPath);
    this.configureAndVerifyPragmas();
    this.applyMigrations(
      migrationsDir ??
        path.resolve(process.cwd(), 'src', 'infrastructure', 'persistence', 'migrations')
    );
  }

  private configureAndVerifyPragmas(): void {
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    if (this.dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec('PRAGMA synchronous = FULL;');

    const status = this.getPragmaStatus();
    if (status.foreignKeys !== 1) {
      this.blockMutations('PRAGMA foreign_keys=ON nao foi ativado');
      throw new PersistenceFailureError('Falha ao ativar PRAGMA foreign_keys=ON');
    }
    if (this.dbPath !== ':memory:' && status.journalMode.toLowerCase() !== 'wal') {
      this.blockMutations(`PRAGMA journal_mode invalido: ${status.journalMode}`);
      throw new PersistenceFailureError(`Esperado journal_mode=wal, obtido ${status.journalMode}`);
    }
    // synchronous FULL em SQLite corresponde ao codigo 2
    if (status.synchronous < 2) {
      this.blockMutations(`PRAGMA synchronous insuficiente: ${status.synchronous}`);
      throw new PersistenceFailureError(`Esperado synchronous=FULL (2), obtido ${status.synchronous}`);
    }
  }

  public getPragmaStatus(): PragmaStatus {
    const jm = this.db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
    const sync = this.db.prepare('PRAGMA synchronous;').get() as { synchronous: number };
    const fk = this.db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number };
    const bt = this.db.prepare('PRAGMA busy_timeout;').get() as { timeout: number };
    return {
      journalMode: jm.journal_mode,
      synchronous: sync.synchronous,
      foreignKeys: fk.foreign_keys,
      busyTimeout: bt.timeout,
    };
  }

  private applyMigrations(migrationsDir: string): void {
    try {
      const sqlFile = path.join(migrationsDir, '001_initial_schema.sql');
      const sql = fs.readFileSync(sqlFile, 'utf-8');
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        this.db.exec(sql);
        const existing = this.db
          .prepare('SELECT version FROM schema_migrations WHERE version = 1')
          .get();
        if (!existing) {
          this.db
            .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
            .run(1, '001_initial_schema.sql', new Date().toISOString());
        }
        const cb = this.db
          .prepare("SELECT breaker_id FROM circuit_breaker_state WHERE breaker_id = 'GLOBAL'")
          .get();
        if (!cb) {
          this.db
            .prepare(
              "INSERT INTO circuit_breaker_state (breaker_id, status, consecutive_failures, updated_at) VALUES ('GLOBAL', 'CLOSED', 0, ?)"
            )
            .run(new Date().toISOString());
        }
        this.db.exec('COMMIT;');
      } catch (err) {
        this.db.exec('ROLLBACK;');
        throw err;
      }
    } catch (err) {
      this.blockMutations('Falha na aplicacao de migracoes SQLite');
      throw new PersistenceFailureError('Erro ao aplicar migracoes SQLite', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  public isMutationBlocked(): boolean {
    return this.mutationBlocked;
  }

  public getMutationBlockReason(): string | null {
    return this.mutationBlockReason;
  }

  public blockMutations(reason: string): void {
    this.mutationBlocked = true;
    this.mutationBlockReason = reason;
  }

  public injectFaultForTesting(fault: 'NONE' | 'DISK_FULL' | 'IO_ERROR' | 'SQLITE_BUSY'): void {
    this.simulatedFault = fault;
  }

  public assertMutationsAllowed(): void {
    if (this.mutationBlocked) {
      throw new MutationBlockedError(
        `Novas mutacoes estao bloqueadas por falha critica: ${this.mutationBlockReason}`
      );
    }
  }

  /**
   * Executa uma transacao curta e atomica de escrita (estado + evento).
   * Qualquer erro de IO/disco cheio/corrupcao faz ROLLBACK e bloqueia futuras mutacoes (S-06).
   */
  public writeTransaction<T>(fn: (db: DatabaseSyncType) => T): T {
    this.assertMutationsAllowed();

    if (this.simulatedFault !== 'NONE') {
      const fault = this.simulatedFault;
      this.blockMutations(`Falha crítica de banco: ${fault}`);
      throw new PersistenceFailureError(`Falha de persistência no SQLite: ${fault}`, { fault });
    }

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = fn(this.db);
      if (this.simulatedFault !== 'NONE') {
        const fault = this.simulatedFault;
        this.blockMutations(`Falha crítica no commit: ${fault}`);
        throw new PersistenceFailureError(`Erro durante commit SQLite: ${fault}`, { fault });
      }
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Ignorar erro secundario de rollback
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('SQLITE_FULL') ||
        msg.includes('SQLITE_IOERR') ||
        msg.includes('SQLITE_CORRUPT') ||
        msg.includes('SQLITE_BUSY') ||
        msg.includes('DISK_FULL') ||
        msg.includes('IO_ERROR')
      ) {
        this.blockMutations(msg);
      }
      if (
        err instanceof FlowAutomationError ||
        err instanceof PersistenceFailureError ||
        err instanceof MutationBlockedError
      ) {
        throw err;
      }
      throw new PersistenceFailureError(`Transacao abortada com rollback: ${msg}`, {
        originalError: msg,
      });
    }
  }

  /**
   * Fila assincrona serializada de escrita para rajadas concorrentes (Arquitetura §15).
   */
  public enqueueWriteTransaction<T>(fn: (db: DatabaseSyncType) => T): Promise<T> {
    const next = this.writeChain.then(() => this.writeTransaction(fn));
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  public read<T>(fn: (db: DatabaseSyncType) => T): T {
    return fn(this.db);
  }

  public listTables(): string[] {
    const rows = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  public close(): void {
    this.db.close();
  }
}
