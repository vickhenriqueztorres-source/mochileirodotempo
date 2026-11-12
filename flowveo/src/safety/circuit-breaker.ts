import { FlowDatabase } from '../infrastructure/persistence/database.js';
import { EventRepository } from '../infrastructure/persistence/repositories/event-repository.js';
import { PolicyDeniedError } from '../shared/errors.js';

export type CircuitBreakerStatus = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerState {
  breakerId: 'GLOBAL';
  status: CircuitBreakerStatus;
  consecutiveFailures: number;
  lastFailureReason: string | null;
  openedAt: string | null;
  updatedAt: string;
}

/**
 * CircuitBreaker Persistido (Arquitetura §17, §20 / BC-18):
 * - Estado duravel no SQLite (sobrevive a reinicios do processo).
 * - Abre automaticamente ao atingir maxConsecutiveFailures ou imediatamente em falha critica.
 * - Reiniciar o processo NAO fecha um circuit breaker OPEN: exige reset explicito do operador apos reconciliacao.
 */
export class CircuitBreaker {
  private readonly flowDb: FlowDatabase;
  private readonly eventRepo: EventRepository;
  private readonly maxConsecutiveFailures: number;

  constructor(params: {
    flowDb: FlowDatabase;
    eventRepo: EventRepository;
    maxConsecutiveFailures: number;
  }) {
    this.flowDb = params.flowDb;
    this.eventRepo = params.eventRepo;
    this.maxConsecutiveFailures = params.maxConsecutiveFailures;
  }

  public getState(): CircuitBreakerState {
    return this.flowDb.read((db) => {
      const row = db
        .prepare("SELECT * FROM circuit_breaker_state WHERE breaker_id = 'GLOBAL'")
        .get() as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Estado GLOBAL do CircuitBreaker nao inicializado no SQLite.');
      }
      return {
        breakerId: 'GLOBAL',
        status: row.status as CircuitBreakerStatus,
        consecutiveFailures: Number(row.consecutive_failures),
        lastFailureReason: row.last_failure_reason ? String(row.last_failure_reason) : null,
        openedAt: row.opened_at ? String(row.opened_at) : null,
        updatedAt: String(row.updated_at),
      };
    });
  }

  public assertClosedOrThrow(): void {
    const state = this.getState();
    if (state.status === 'OPEN') {
      throw new PolicyDeniedError(
        `CircuitBreaker persistido esta OPEN desde ${state.openedAt}: ${state.lastFailureReason}. Reconcilie antes de prosseguir.`
      );
    }
  }

  public recordSuccess(): CircuitBreakerState {
    return this.flowDb.writeTransaction((db) => {
      const nowIso = new Date().toISOString();
      db.prepare(
        `UPDATE circuit_breaker_state
         SET status = 'CLOSED', consecutive_failures = 0, last_failure_reason = NULL, opened_at = NULL, updated_at = ?
         WHERE breaker_id = 'GLOBAL'`
      ).run(nowIso);
      return this.getState();
    });
  }

  public recordFailure(params: {
    reason: string;
    immediateTrip?: boolean;
    controllerEpoch: number;
    jobId?: string | null;
  }): CircuitBreakerState {
    return this.flowDb.writeTransaction((db) => {
      const current = this.getState();
      const nextCount = current.consecutiveFailures + 1;
      const shouldOpen =
        Boolean(params.immediateTrip) || nextCount >= this.maxConsecutiveFailures;
      const nextStatus: CircuitBreakerStatus = shouldOpen ? 'OPEN' : current.status;
      const nowIso = new Date().toISOString();
      const openedAt = shouldOpen ? (current.openedAt ?? nowIso) : current.openedAt;

      db.prepare(
        `UPDATE circuit_breaker_state
         SET status = ?, consecutive_failures = ?, last_failure_reason = ?, opened_at = ?, updated_at = ?
         WHERE breaker_id = 'GLOBAL'`
      ).run(nextStatus, nextCount, params.reason, openedAt, nowIso);

      if (shouldOpen && current.status !== 'OPEN') {
        this.eventRepo.insertWithinTransaction(db, {
          eventType: 'circuit.opened',
          correlationId: 'circuit_global',
          jobId: params.jobId ?? null,
          controllerEpoch: params.controllerEpoch,
          policyVersion: '1.0.0',
          registryVersion: 'ACTIVE',
          reason: `CircuitBreaker aberto (${nextCount}/${this.maxConsecutiveFailures}): ${params.reason}`,
          payload: {
            consecutiveFailures: nextCount,
            immediateTrip: Boolean(params.immediateTrip),
          },
        });
      }

      return this.getState();
    });
  }

  public resetByOperator(operatorReason: string, controllerEpoch: number): CircuitBreakerState {
    if (!operatorReason || operatorReason.trim().length < 3) {
      throw new PolicyDeniedError(
        'Reset do CircuitBreaker exige justificativa explicita do operador.'
      );
    }
    return this.flowDb.writeTransaction((db) => {
      const nowIso = new Date().toISOString();
      db.prepare(
        `UPDATE circuit_breaker_state
         SET status = 'CLOSED', consecutive_failures = 0, last_failure_reason = NULL, opened_at = NULL, updated_at = ?
         WHERE breaker_id = 'GLOBAL'`
      ).run(nowIso);

      this.eventRepo.insertWithinTransaction(db, {
        eventType: 'system.preflight',
        correlationId: 'circuit_global',
        jobId: null,
        controllerEpoch,
        policyVersion: '1.0.0',
        registryVersion: 'ACTIVE',
        reason: `CircuitBreaker resetado pelo operador: ${operatorReason}`,
        payload: {},
      });

      return this.getState();
    });
  }
}
