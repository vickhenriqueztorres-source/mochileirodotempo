import { PermitStore } from './permit-store.js';

export type StopReason = 'SIGINT' | 'SIGTERM' | 'USER_STOP' | 'CIRCUIT_BREAKER' | 'FATAL_ERROR';

export interface StopStatus {
  stopRequested: boolean;
  reason: StopReason | null;
  requestedAtMs: number | null;
  drained: boolean;
}

/**
 * Stop Controller (Arquitetura §20 / A-19):
 * Em Ctrl+C ou comando 'flow stop', interrompe agendamento de novas acoes,
 * drena operacao local com prazo e revoga/persiste incertezas para reconciliacao no proximo startup.
 */
export class StopController {
  private stopRequested = false;
  private reason: StopReason | null = null;
  private requestedAtMs: number | null = null;
  private drained = false;
  private readonly permitStore: PermitStore;

  constructor(permitStore: PermitStore) {
    this.permitStore = permitStore;
  }

  public requestStop(reason: StopReason, controllerEpoch: number): StopStatus {
    if (!this.stopRequested) {
      this.stopRequested = true;
      this.reason = reason;
      this.requestedAtMs = Date.now();
      // Revoga permissoes ISSUED e sinaliza CLAIMED interrompidas para reconciliacao
      this.permitStore.revokeAllInFlightPermitsOnStartup(
        controllerEpoch,
        `Parada controlada solicitada (${reason})`
      );
      this.drained = true;
    }
    return this.getStatus();
  }

  public assertNotStopped(): void {
    if (this.stopRequested) {
      throw new Error(`Agendamento bloqueado: parada em andamento (${this.reason}).`);
    }
  }

  public isStopped(): boolean {
    return this.stopRequested;
  }

  public getStatus(): StopStatus {
    return {
      stopRequested: this.stopRequested,
      reason: this.reason,
      requestedAtMs: this.requestedAtMs,
      drained: this.drained,
    };
  }
}
