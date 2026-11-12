import type { ActionPlan, ExecutionPermit } from '../../domain/actions/action-types.js';
import type {
  ContextSnapshot,
  CreationSnapshot,
  ResultObservation,
} from '../../flow/contracts.js';
import { sha256Hex } from '../observability/redactor.js';
import { EventRepository } from '../persistence/repositories/event-repository.js';
import { PermitStore } from '../../safety/permit-store.js';
import type { InternalDriverExecutionPort } from './authorized-executor.js';
import { NavigationGuard } from './navigation-guard.js';

export interface SimulatedDomControl {
  controlId: string;
  containerId: string;
  role: string;
  name: string;
  label?: string;
  placeholder?: string;
  testId?: string;
  visible: boolean;
  enabled: boolean;
  matchesCount: number;
  currentValue?: string;
  menuOpen?: boolean;
}

export interface SimulatedPageState {
  url: string;
  locale: string;
  viewport: { width: number; height: number };
  accountContextId: string;
  projectContextId: string;
  creationMode: string;
  observedVariant: string;
  isAuthenticated: boolean;
  hasCaptchaOrVerification: boolean;
  humanInterferenceDetected: boolean;
  selectedModel: string;
  selectedAspectRatio: string;
  selectedOutputsCount: number;
  promptText: string;
  uploadReadyFilename: string | null;
  observedRevision: number;
  controls: SimulatedDomControl[];
  results: ResultObservation[];
  isResultsVirtualizedOrPartial: boolean;
}

/**
 * FlowDriver interno da camada infrastructure/browser (Arquitetura §3, §5, §6, §7).
 * - Nao e exportado para application ou cli.
 * - Proibe force: true, dispatchEvent e cliques via evaluate (S-04).
 * - Pausa imediatamente em sessao invalida, CAPTCHA, popup inesperado ou interferencia humana (A-20, S-09).
 */
export class FlowDriver implements InternalDriverExecutionPort {
  private readonly navigationGuard: NavigationGuard;
  private readonly permitStore: PermitStore;
  private readonly eventRepo: EventRepository;
  private controllerEpoch: number;
  private sessionEpoch: number;
  private pageId: string;
  private paused = false;
  private pauseReason: 'AUTH' | 'POLICY' | 'UI_DRIFT' | 'UNKNOWN_STATE' | 'CONTROLLER_LOST' | 'USER' | null =
    null;
  private state: SimulatedPageState;
  private mutationLog: Array<{ actionKind: string; targetControlId: string; timestamp: number }> = [];

  // Hooks de injecao de falhas locais para os testes de caos (Arquitetura §23)
  private postClickBehavior:
    | 'NORMAL'
    | 'NO_EFFECT_POSTCONDITION_FAIL'
    | 'DELAYED_HYDRATION_WIPE_PROMPT'
    | 'TIMEOUT_AFTER_SUBMIT_CLICK' = 'NORMAL';

  constructor(params: {
    navigationGuard: NavigationGuard;
    permitStore: PermitStore;
    eventRepo: EventRepository;
    controllerEpoch: number;
    sessionEpoch: number;
    pageId: string;
    initialState: SimulatedPageState;
  }) {
    this.navigationGuard = params.navigationGuard;
    this.permitStore = params.permitStore;
    this.eventRepo = params.eventRepo;
    this.controllerEpoch = params.controllerEpoch;
    this.sessionEpoch = params.sessionEpoch;
    this.pageId = params.pageId;
    this.state = { ...params.initialState };
  }

  public setPostClickBehaviorForTesting(
    behavior:
      | 'NORMAL'
      | 'NO_EFFECT_POSTCONDITION_FAIL'
      | 'DELAYED_HYDRATION_WIPE_PROMPT'
      | 'TIMEOUT_AFTER_SUBMIT_CLICK'
  ): void {
    this.postClickBehavior = behavior;
  }

  public updateSimulatedPageState(patch: Partial<SimulatedPageState>): void {
    this.state = { ...this.state, ...patch };
  }

  public getMutationCount(): number {
    return this.mutationLog.length;
  }

  public getMutationLog(): ReadonlyArray<{
    actionKind: string;
    targetControlId: string;
    timestamp: number;
  }> {
    return this.mutationLog;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public getPauseReason(): string | null {
    return this.pauseReason;
  }

  private pauseAndRevoke(
    reasonCode: 'AUTH' | 'POLICY' | 'UI_DRIFT' | 'UNKNOWN_STATE' | 'CONTROLLER_LOST' | 'USER',
    detail: string
  ): void {
    this.paused = true;
    this.pauseReason = reasonCode;
    this.sessionEpoch += 1;
    this.permitStore.revokeAllInFlightPermitsOnStartup(this.controllerEpoch, detail);
    this.eventRepo.recordStandaloneEvent({
      eventType: 'controller.paused',
      correlationId: `pause_${this.controllerEpoch}_${this.sessionEpoch}`,
      controllerEpoch: this.controllerEpoch,
      policyVersion: '1.0.0',
      registryVersion: 'ACTIVE',
      reason: detail,
      payload: { pauseReason: reasonCode },
    });
  }

  public simulateUnexpectedPopup(popupUrl: string, isLoginLifecycleMode = false): void {
    const decision = this.navigationGuard.onPopupDetected(popupUrl, isLoginLifecycleMode);
    if (!decision.allowed && decision.pauseRequired) {
      this.pauseAndRevoke(decision.pauseReason ?? 'UNKNOWN_STATE', decision.reason);
    }
  }

  public computeConfigDigest(): string {
    return sha256Hex(
      JSON.stringify({
        projectContextId: this.state.projectContextId,
        model: this.state.selectedModel,
        aspectRatio: this.state.selectedAspectRatio,
        outputs: this.state.selectedOutputsCount,
        promptDigest: sha256Hex(this.state.promptText),
        uploadReadyFilename: this.state.uploadReadyFilename,
      })
    );
  }

  public async readLiveContextAndConfig(): Promise<{
    context: ContextSnapshot;
    creation: CreationSnapshot;
  }> {
    const navCheck = this.navigationGuard.checkNavigation({
      url: this.state.url,
      isMainFrame: true,
      resourceType: 'document',
      isLoginLifecycleMode: false,
      projectContextId: this.state.projectContextId,
    });

    if (!navCheck.allowed && navCheck.pauseRequired) {
      this.pauseAndRevoke(navCheck.pauseReason ?? 'POLICY', navCheck.reason);
    }

    if (!this.state.isAuthenticated || this.state.hasCaptchaOrVerification) {
      this.pauseAndRevoke(
        'AUTH',
        this.state.hasCaptchaOrVerification
          ? 'Desafio CAPTCHA/verificacao detectado — pausando sem contornar (A-20).'
          : 'Sessao deslogada detectada — pausando sem contornar (A-20).'
      );
    }

    if (this.state.humanInterferenceDetected) {
      this.pauseAndRevoke(
        'UNKNOWN_STATE',
        'Interferencia humana detectada na pagina dedicada (S-09).'
      );
    }

    const context: ContextSnapshot = {
      controllerEpoch: this.controllerEpoch,
      sessionEpoch: this.sessionEpoch,
      pageId: this.pageId,
      url: this.state.url,
      locale: this.state.locale,
      viewport: { ...this.state.viewport },
      accountContextId: this.state.accountContextId,
      projectContextId: this.state.projectContextId,
      creationMode: this.state.creationMode,
      observedVariant: this.state.observedVariant,
      observedRevision: this.state.observedRevision,
      isAuthenticated: this.state.isAuthenticated,
      hasCaptchaOrVerification: this.state.hasCaptchaOrVerification,
      humanInterferenceDetected: this.state.humanInterferenceDetected,
    };

    const creation: CreationSnapshot = {
      selectedModel: this.state.selectedModel,
      selectedAspectRatio: this.state.selectedAspectRatio,
      selectedOutputsCount: this.state.selectedOutputsCount,
      promptText: this.state.promptText,
      promptDigestSha256: sha256Hex(this.state.promptText),
      uploadReadyFilename: this.state.uploadReadyFilename,
      observedConfigDigest: this.computeConfigDigest(),
      observedRevision: this.state.observedRevision,
    };

    return { context, creation };
  }

  public inspectControlsPassively(): ReadonlyArray<SimulatedDomControl> {
    // Leitura 100% passiva: nao incrementa mutationLog nem altera estado (A-06)
    return this.state.controls.map((c) => ({ ...c }));
  }

  public inspectResultsPassively(): {
    isVirtualizedOrPartial: boolean;
    items: ResultObservation[];
  } {
    return {
      isVirtualizedOrPartial: this.state.isResultsVirtualizedOrPartial,
      items: this.state.results.map((r) => ({ ...r })),
    };
  }

  public async performAuthorizedMutation(
    plan: ActionPlan,
    _permit: ExecutionPermit
  ): Promise<{
    observedRevisionAfter: number;
    postconditionVerified: boolean;
    details: Record<string, unknown>;
  }> {
    if (this.paused) {
      throw new Error(`Driver pausado (${this.pauseReason}) — mutacao bloqueada.`);
    }

    // Proibir opcoes ilegais no payload (S-04: force, dispatchEvent, evaluateScript)
    if (
      plan.paramsCanonical.force === true ||
      plan.paramsCanonical.dispatchEvent === true ||
      typeof plan.paramsCanonical.evaluateScript === 'string'
    ) {
      throw new Error(
        'Proibido usar force: true, dispatchEvent ou cliques via evaluate no fluxo produtivo (S-04).'
      );
    }

    const ctrl = this.state.controls.find((c) => c.controlId === plan.targetControlId);
    if (!ctrl || !ctrl.visible || !ctrl.enabled || ctrl.matchesCount !== 1) {
      throw new Error(
        `Controle '${plan.targetControlId}' ausente, desabilitado ou duplicado (matches=${ctrl?.matchesCount ?? 0}).`
      );
    }

    // Registrar a mutacao executada
    this.mutationLog.push({
      actionKind: plan.actionKind,
      targetControlId: plan.targetControlId,
      timestamp: Date.now(),
    });
    this.state.observedRevision += 1;

    if (this.postClickBehavior === 'NO_EFFECT_POSTCONDITION_FAIL') {
      return {
        observedRevisionAfter: this.state.observedRevision,
        postconditionVerified: false,
        details: { reason: 'Clique nao produziu a pos-condicao esperada na UI (A-11).' },
      };
    }

    if (plan.actionKind === 'OPEN_UI') {
      ctrl.menuOpen = true;
      return {
        observedRevisionAfter: this.state.observedRevision,
        postconditionVerified: ctrl.menuOpen === true,
        details: { menuOpen: true, containerId: ctrl.containerId },
      };
    }

    if (plan.actionKind === 'CONFIGURE') {
      if (typeof plan.paramsCanonical.model === 'string') {
        this.state.selectedModel = plan.paramsCanonical.model;
      }
      if (typeof plan.paramsCanonical.aspectRatio === 'string') {
        this.state.selectedAspectRatio = plan.paramsCanonical.aspectRatio;
      }
      if (typeof plan.paramsCanonical.outputsCount === 'number') {
        this.state.selectedOutputsCount = plan.paramsCanonical.outputsCount;
      }
      // Reler valor efetivo para comprovar pos-condicao (Arquitetura §17)
      const modelOk =
        plan.paramsCanonical.model === undefined ||
        this.state.selectedModel === plan.paramsCanonical.model;
      const ratioOk =
        plan.paramsCanonical.aspectRatio === undefined ||
        this.state.selectedAspectRatio === plan.paramsCanonical.aspectRatio;
      return {
        observedRevisionAfter: this.state.observedRevision,
        postconditionVerified: modelOk && ratioOk,
        details: {
          selectedModel: this.state.selectedModel,
          selectedAspectRatio: this.state.selectedAspectRatio,
        },
      };
    }

    if (plan.actionKind === 'FILL') {
      const requestedPrompt = String(plan.paramsCanonical.promptText ?? '');
      this.state.promptText = requestedPrompt;

      // Simular hidratacao atrasada que apaga ou trunca o texto apos o preenchimento (Arquitetura §23)
      if (this.postClickBehavior === 'DELAYED_HYDRATION_WIPE_PROMPT') {
        this.state.promptText = requestedPrompt.slice(0, 3);
      }

      // Reler o texto estabilizado e verificar igualdade exata (Arquitetura §17)
      const stabilizedOk = this.state.promptText === requestedPrompt;
      return {
        observedRevisionAfter: this.state.observedRevision,
        postconditionVerified: stabilizedOk,
        details: {
          expectedLength: requestedPrompt.length,
          observedLength: this.state.promptText.length,
        },
      };
    }

    if (plan.actionKind === 'UPLOAD') {
      const filename = String(plan.paramsCanonical.filename ?? 'frame.png');
      this.state.uploadReadyFilename = filename;
      return {
        observedRevisionAfter: this.state.observedRevision,
        postconditionVerified: this.state.uploadReadyFilename === filename,
        details: { uploadReadyFilename: this.state.uploadReadyFilename },
      };
    }

    if (plan.actionKind === 'SUBMIT') {
      if (this.postClickBehavior === 'TIMEOUT_AFTER_SUBMIT_CLICK') {
        throw new Error('PLAYWRIGHT_TIMEOUT_AFTER_SUBMIT_CLICK');
      }
      const newRemoteId = `rem_${this.state.observedRevision}`;
      this.state.results.push({
        remoteExternalId: newRemoteId,
        remoteAssetId: `asset_${this.state.observedRevision}`,
        resultIndex: 0,
        status: 'PROCESSING',
        promptSnippetDigest: sha256Hex(this.state.promptText),
        createdAtLabel: 'just now',
        downloadControlId: `ctrl_dl_${newRemoteId}`,
      });
      return {
        observedRevisionAfter: this.state.observedRevision,
        postconditionVerified: true,
        details: { remoteExternalId: newRemoteId },
      };
    }

    return {
      observedRevisionAfter: this.state.observedRevision,
      postconditionVerified: true,
      details: {},
    };
  }
}
