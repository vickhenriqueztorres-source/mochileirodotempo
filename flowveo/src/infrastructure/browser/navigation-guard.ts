import type { PolicyConfig } from '../../shared/config-schema.js';

export type ResourceKind =
  | 'document'
  | 'stylesheet'
  | 'image'
  | 'media'
  | 'font'
  | 'script'
  | 'xhr'
  | 'fetch'
  | 'websocket'
  | 'other';

export interface NavigationCheckInput {
  url: string;
  isMainFrame: boolean;
  resourceType: ResourceKind;
  isLoginLifecycleMode: boolean;
  projectContextId?: string;
}

export interface NavigationDecision {
  allowed: boolean;
  pauseRequired: boolean;
  pauseReason?: 'AUTH' | 'POLICY' | 'UNKNOWN_STATE';
  reason: string;
}

/**
 * Navigation Guard (Arquitetura §7 / S-08):
 * - Valida a pagina de trabalho e o projeto no frame principal (document).
 * - Origens necessarias a sub-recursos (script, font, image, stylesheet, fetch) nao sao
 *   bloqueadas indiscriminadamente, evitando quebrar assets do Flow.
 * - Popups inesperados fora do modo login pausam imediatamente a execucao.
 */
export class NavigationGuard {
  private readonly policy: PolicyConfig;

  constructor(policy: PolicyConfig) {
    this.policy = policy;
  }

  public checkNavigation(input: NavigationCheckInput): NavigationDecision {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(input.url);
    } catch {
      return {
        allowed: false,
        pauseRequired: true,
        pauseReason: 'POLICY',
        reason: `URL malformada ou invalida: ${input.url}`,
      };
    }

    if (parsedUrl.protocol !== 'https:') {
      return {
        allowed: false,
        pauseRequired: true,
        pauseReason: 'POLICY',
        reason: `Protocolo inseguro '${parsedUrl.protocol}' bloqueado (exigido https:).`,
      };
    }

    // Sub-recursos (nao mainFrame document) sao permitidos em HTTPS (Arquitetura §7)
    if (!input.isMainFrame || input.resourceType !== 'document') {
      return {
        allowed: true,
        pauseRequired: false,
        reason: `Sub-recurso '${input.resourceType}' permitido.`,
      };
    }

    const origin = parsedUrl.origin;
    const isWorkOrigin = this.policy.allowedWorkOrigins.includes(origin);
    const isLoginOrigin = this.policy.allowedLoginOrigins.includes(origin);

    if (input.isLoginLifecycleMode) {
      if (isWorkOrigin || isLoginOrigin) {
        return {
          allowed: true,
          pauseRequired: false,
          reason: `Navegacao de lifecycle login autorizada em ${origin}.`,
        };
      }
      return {
        allowed: false,
        pauseRequired: true,
        pauseReason: 'POLICY',
        reason: `Origem '${origin}' nao autorizada nem para login nem para trabalho.`,
      };
    }

    // Em modo de trabalho (fora do login manual), redirecionamento para accounts.google.com indica sessao expirada (A-20)
    if (isLoginOrigin) {
      return {
        allowed: false,
        pauseRequired: true,
        pauseReason: 'AUTH',
        reason: `Redirecionamento para origem de login '${origin}' durante operacao — sessao expirada (A-20).`,
      };
    }

    if (!isWorkOrigin) {
      return {
        allowed: false,
        pauseRequired: true,
        pauseReason: 'POLICY',
        reason: `Origem de navegacao principal '${origin}' fora da allowlist de trabalho (S-08).`,
      };
    }

    if (
      input.projectContextId &&
      !this.policy.authorizedProjects.includes(input.projectContextId)
    ) {
      return {
        allowed: false,
        pauseRequired: true,
        pauseReason: 'POLICY',
        reason: `Projeto '${input.projectContextId}' nao autorizado pela politica (S-08).`,
      };
    }

    return {
      allowed: true,
      pauseRequired: false,
      reason: `Navegacao principal autorizada em ${origin}.`,
    };
  }

  public onPopupDetected(popupUrl: string, isLoginLifecycleMode: boolean): NavigationDecision {
    if (isLoginLifecycleMode) {
      try {
        const origin = new URL(popupUrl).origin;
        if (this.policy.allowedLoginOrigins.includes(origin)) {
          return {
            allowed: true,
            pauseRequired: false,
            reason: `Popup de autenticacao autorizado durante login manual (${origin}).`,
          };
        }
      } catch {
        // cai no bloqueio abaixo
      }
    }

    return {
      allowed: false,
      pauseRequired: true,
      pauseReason: 'UNKNOWN_STATE',
      reason: `Popup inesperado detectado fora do fluxo autorizado (${popupUrl}) — execucao pausada (Arquitetura §7).`,
    };
  }
}
