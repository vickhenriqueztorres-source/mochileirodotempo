import type { ActionPlan } from '../domain/actions/action-types.js';
import {
  MODE_ALLOWED_ACTIONS,
  isActionAllowedInRelease,
} from '../domain/policies/policy-types.js';
import type { ContextSnapshot } from '../flow/contracts.js';
import type { AppConfig, PolicyConfig } from '../shared/config-schema.js';

export interface TransitionApprovalCheck {
  transitionStatus: 'candidate' | 'validated' | 'invalidated';
  controlStatus: 'candidate' | 'validated' | 'invalidated';
  observedMatches: number;
  hasOperatorBootstrapApproval?: boolean;
  approvedForModes: string[];
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  code: string;
  reason: string;
}

export class PolicyEngine {
  private readonly appConfig: AppConfig;
  private readonly policyConfig: PolicyConfig;

  constructor(appConfig: AppConfig, policyConfig: PolicyConfig) {
    this.appConfig = appConfig;
    this.policyConfig = policyConfig;
  }

  public evaluate(
    plan: ActionPlan,
    snapshot: ContextSnapshot,
    transitionCheck: TransitionApprovalCheck
  ): PolicyEvaluationResult {
    // 1. Verificar autenticacao e ausencia de CAPTCHA/interferencia humana (A-20, S-09)
    if (!snapshot.isAuthenticated && plan.actionKind !== 'LIFECYCLE') {
      return {
        allowed: false,
        code: 'AUTH_REQUIRED',
        reason: 'Sessao nao autenticada — operacao pausada (A-20).',
      };
    }

    if (snapshot.hasCaptchaOrVerification) {
      return {
        allowed: false,
        code: 'CAPTCHA_DETECTED',
        reason: 'CAPTCHA ou verificacao detectada — proibido contornar (A-20).',
      };
    }

    if (snapshot.humanInterferenceDetected) {
      return {
        allowed: false,
        code: 'HUMAN_INTERFERENCE',
        reason: 'Interferencia humana detectada durante operacao — contexto invalidado (S-09).',
      };
    }

    // 2. Verificar versao da politica
    if (plan.policyVersion !== this.policyConfig.policyVersion) {
      return {
        allowed: false,
        code: 'POLICY_VERSION_MISMATCH',
        reason: `Versao da politica do plano (${plan.policyVersion}) difere da ativa (${this.policyConfig.policyVersion}).`,
      };
    }

    // 3. Verificar conta e projeto autorizados (S-08)
    if (
      plan.accountContextId !== snapshot.accountContextId ||
      !this.policyConfig.authorizedAccounts.includes(plan.accountContextId)
    ) {
      return {
        allowed: false,
        code: 'UNAUTHORIZED_ACCOUNT',
        reason: `Conta '${plan.accountContextId}' nao autorizada ou divergente do contexto atual.`,
      };
    }

    if (
      plan.projectContextId !== snapshot.projectContextId ||
      !this.policyConfig.authorizedProjects.includes(plan.projectContextId)
    ) {
      return {
        allowed: false,
        code: 'UNAUTHORIZED_PROJECT',
        reason: `Projeto '${plan.projectContextId}' nao autorizado ou divergente do contexto atual.`,
      };
    }

    // 4. Trava de Release A (A-18)
    if (!isActionAllowedInRelease(plan.actionKind, this.policyConfig.releasePhase)) {
      return {
        allowed: false,
        code: 'RELEASE_A_SUBMIT_BLOCKED',
        reason: `Acao '${plan.actionKind}' bloqueada na Release ${this.policyConfig.releasePhase} (A-18).`,
      };
    }

    // 5. Trava de executionEnabled para SUBMIT
    if (plan.actionKind === 'SUBMIT' && !this.appConfig.executionEnabled) {
      return {
        allowed: false,
        code: 'EXECUTION_DISABLED',
        reason: 'Submissao bloqueada porque executionEnabled=false.',
      };
    }

    // 6. Verificar matriz Modo x ActionKind (Arquitetura §6)
    const allowedSet = MODE_ALLOWED_ACTIONS[plan.mode];
    if (!allowedSet || !allowedSet.has(plan.actionKind)) {
      return {
        allowed: false,
        code: 'MODE_ACTION_FORBIDDEN',
        reason: `Acao '${plan.actionKind}' nao permitida no modo '${plan.mode}'.`,
      };
    }

    // 7. Unicidade de controle (A-12: expectedMatches === 1)
    if (transitionCheck.observedMatches !== 1) {
      return {
        allowed: false,
        code: 'AMBIGUOUS_OR_MISSING_TARGET',
        reason: `Alvo '${plan.targetControlId}' possui ${transitionCheck.observedMatches} correspondencias (exigido exatamente 1 — A-12).`,
      };
    }

    // 8. Status do controle e da transicao conforme o modo (A-08, A-09, A-10)
    if (
      transitionCheck.controlStatus === 'invalidated' ||
      transitionCheck.transitionStatus === 'invalidated'
    ) {
      return {
        allowed: false,
        code: 'CONTROL_OR_TRANSITION_INVALIDATED',
        reason: 'Controle ou transicao foi invalidado por drift ou falha de pos-condicao.',
      };
    }

    if (plan.mode === 'bootstrap') {
      if (!transitionCheck.hasOperatorBootstrapApproval) {
        return {
          allowed: false,
          code: 'BOOTSTRAP_APPROVAL_REQUIRED',
          reason: 'Modo bootstrap exige aprovacao concreta do operador para esta transicao (A-09).',
        };
      }
    } else if (plan.actionKind !== 'READ') {
      // Nos modos explore, validate, prepare, execute, reconcile: exige transicao e controle 'validated'
      if (
        transitionCheck.controlStatus !== 'validated' ||
        transitionCheck.transitionStatus !== 'validated'
      ) {
        return {
          allowed: false,
          code: 'UNVALIDATED_TRANSITION',
          reason: `Acao '${plan.actionKind}' no modo '${plan.mode}' exige controle e transicao 'validated' (A-08/A-10).`,
        };
      }
      if (!transitionCheck.approvedForModes.includes(plan.mode)) {
        return {
          allowed: false,
          code: 'TRANSITION_MODE_NOT_APPROVED',
          reason: `Transicao '${plan.transitionId}' nao foi homologada para o modo '${plan.mode}'.`,
        };
      }
    }

    return {
      allowed: true,
      code: 'ALLOWED',
      reason: `Acao '${plan.actionKind}' autorizada para '${plan.targetControlId}' no modo '${plan.mode}'.`,
    };
  }
}
