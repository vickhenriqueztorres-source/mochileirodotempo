import type { ActionOutcome, ActionPlan, ExecutionPermit } from '../../domain/actions/action-types.js';
import type { AuthorizedExecutor, ContextSnapshot, CreationSnapshot } from '../../flow/contracts.js';
import { PermitStore } from '../../safety/permit-store.js';

/**
 * Porta interna do FlowDriver restrita a camada infrastructure/browser.
 * Nunca exporta Page, Locator ou BrowserContext (Arquitetura §5 e §9).
 */
export interface InternalDriverExecutionPort {
  readLiveContextAndConfig(): Promise<{
    context: ContextSnapshot;
    creation: CreationSnapshot;
  }>;
  performAuthorizedMutation(
    plan: ActionPlan,
    permit: ExecutionPermit
  ): Promise<{
    observedRevisionAfter: number;
    postconditionVerified: boolean;
    details: Record<string, unknown>;
  }>;
}

export class DefaultAuthorizedExecutor implements AuthorizedExecutor {
  private readonly permitStore: PermitStore;
  private readonly driverPort: InternalDriverExecutionPort;
  private readonly registryVersionProvider: () => string;
  private readonly policyVersionProvider: () => string;
  private serialQueue: Promise<unknown> = Promise.resolve();

  constructor(params: {
    permitStore: PermitStore;
    driverPort: InternalDriverExecutionPort;
    registryVersionProvider: () => string;
    policyVersionProvider: () => string;
  }) {
    this.permitStore = params.permitStore;
    this.driverPort = params.driverPort;
    this.registryVersionProvider = params.registryVersionProvider;
    this.policyVersionProvider = params.policyVersionProvider;
  }

  /**
   * Recebe APENAS permitId (Arquitetura §9).
   * Enfileira na fila serial unica (Arquitetura §7), rele invariantes imediatamente antes
   * da mutacao (S-03), consome CLAIMED atomicamente e executa uma unica acao.
   */
  public execute(permitId: string): Promise<ActionOutcome> {
    const task = this.serialQueue.then(() => this.executeSerial(permitId));
    this.serialQueue = task.catch(() => undefined);
    return task;
  }

  private async executeSerial(permitId: string): Promise<ActionOutcome> {
    // Passo 5 do Protocolo (Arquitetura §10): Reler invariantes criticas imediatamente antes da mutacao
    const live = await this.driverPort.readLiveContextAndConfig();

    if (!live.context.isAuthenticated || live.context.hasCaptchaOrVerification) {
      throw new Error('Sessao invalida ou CAPTCHA detectado na releitura pre-mutacao.');
    }

    // Passo 6 e 7: Comparar contexto/parametros com o plano e marcar CLAIMED atomicamente
    const { permit, plan } = this.permitStore.claimPermitAtomically(permitId, {
      controllerEpoch: live.context.controllerEpoch,
      sessionEpoch: live.context.sessionEpoch,
      pageId: live.context.pageId,
      projectContextId: live.context.projectContextId,
      accountContextId: live.context.accountContextId,
      registryVersion: this.registryVersionProvider(),
      policyVersion: this.policyVersionProvider(),
      observedConfigDigest: live.creation.observedConfigDigest,
      observedRevision: live.context.observedRevision,
    });

    // Passo 8: Executar uma unica acao no driver interno
    const driverRes = await this.driverPort.performAuthorizedMutation(plan, permit);

    // Passo 9: Observar pos-condicao e persistir outcome
    const outcome: ActionOutcome = {
      permitId: permit.permitId,
      planId: plan.planId,
      actionKind: plan.actionKind,
      status: driverRes.postconditionVerified ? 'SUCCESS' : 'POSTCONDITION_FAILED',
      observedRevisionAfter: driverRes.observedRevisionAfter,
      postconditionVerified: driverRes.postconditionVerified,
      details: driverRes.details,
    };

    this.permitStore.markPermitFinished(permitId, outcome);
    return outcome;
  }
}
