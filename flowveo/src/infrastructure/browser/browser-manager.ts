import fs from 'node:fs';
import path from 'node:path';
import { PermitStore } from '../../safety/permit-store.js';
import { ConfigValidationError } from '../../shared/errors.js';

export interface BrowserSessionMetadata {
  profileDir: string;
  controllerEpoch: number;
  sessionEpoch: number;
  pageId: string;
  isOpen: boolean;
}

/**
 * Browser Manager (Arquitetura §7 / A-03):
 * - Exige perfil dedicado em runtime/profile (rejeita perfil pessoal do Chrome/Edge).
 * - Mantem 1 unica pagina de trabalho dedicada.
 * - Reinicio, recarga, nova pagina ou troca de sessao incrementa sessionEpoch e revoga permissoes antigas.
 */
export class BrowserManager {
  private readonly profileDir: string;
  private readonly permitStore: PermitStore;
  private controllerEpoch: number;
  private sessionEpoch = 1;
  private pageId = 'page_work_1';
  private isOpen = false;

  constructor(params: {
    profileDir: string;
    controllerEpoch: number;
    permitStore: PermitStore;
  }) {
    const normalized = params.profileDir.replace(/\\/g, '/').toLowerCase();
    if (
      normalized.includes('google/chrome/user data') ||
      normalized.includes('microsoft/edge/user data') ||
      normalized.includes('appdata/local/google/chrome')
    ) {
      throw new ConfigValidationError(
        'Proibido usar perfil pessoal do navegador no BrowserManager (A-03).'
      );
    }

    this.profileDir = path.resolve(params.profileDir);
    fs.mkdirSync(this.profileDir, { recursive: true });
    this.controllerEpoch = params.controllerEpoch;
    this.permitStore = params.permitStore;
  }

  public openDedicatedSession(): BrowserSessionMetadata {
    this.isOpen = true;
    return this.getMetadata();
  }

  /**
   * Qualquer recarga, nova pagina ou troca de sessao incrementa sessionEpoch
   * e revoga imediatamente todas as permissoes pendentes (Arquitetura §7).
   */
  public notifyPageReloadOrSessionChange(reason: string): BrowserSessionMetadata {
    this.sessionEpoch += 1;
    this.pageId = `page_work_${this.sessionEpoch}`;
    this.permitStore.revokeAllInFlightPermitsOnStartup(
      this.controllerEpoch,
      `Mudanca de sessao/recarga detectada (sessionEpoch=${this.sessionEpoch}): ${reason}`
    );
    return this.getMetadata();
  }

  public closeSession(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.permitStore.revokeAllInFlightPermitsOnStartup(
      this.controllerEpoch,
      'Sessao de navegador encerrada'
    );
  }

  public getMetadata(): BrowserSessionMetadata {
    return {
      profileDir: this.profileDir,
      controllerEpoch: this.controllerEpoch,
      sessionEpoch: this.sessionEpoch,
      pageId: this.pageId,
      isOpen: this.isOpen,
    };
  }
}
