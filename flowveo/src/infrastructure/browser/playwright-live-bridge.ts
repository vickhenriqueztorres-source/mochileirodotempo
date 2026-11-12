import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { SimulatedDomControl, SimulatedPageState } from './flow-driver.js';

export interface LiveBrowserConnectOptions {
  chromeExecutablePath?: string;
  userDataDir: string;
  profileDirectory?: string;
  targetUrl: string;
  cdpPort?: number;
}

/**
 * Ponte real Playwright/CDP contida estritamente em infrastructure/browser (Arquitetura §3, §7).
 * - Nunca expoe Page, Locator ou BrowserContext fora desta camada.
 * - Extrai controles reais da interface Google Flow e sincroniza com o FlowDriver auditavel.
 */
export class PlaywrightLiveBridge {
  private chromeProcess: ChildProcess | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  public async connectAndOpenFlow(options: LiveBrowserConnectOptions): Promise<SimulatedPageState> {
    const chromeExe =
      options.chromeExecutablePath ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const cdpPort = options.cdpPort ?? 9333;
    const args = [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${options.userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ];
    if (options.profileDirectory) {
      args.push(`--profile-directory=${options.profileDirectory}`);
    }
    args.push(options.targetUrl);

    this.chromeProcess = spawn(chromeExe, args, {
      detached: true,
      stdio: 'ignore',
    });
    this.chromeProcess.unref();

    let connected = false;
    for (let i = 0; i < 30; i++) {
      try {
        this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
        connected = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    if (!connected || !this.browser) {
      throw new Error(`Nao foi possivel conectar ao Chrome via CDP na porta ${cdpPort}`);
    }

    const contexts = this.browser.contexts();
    this.context = contexts[0] ?? (await this.browser.newContext());
    const pages = this.context.pages();
    this.page =
      pages.find((p) => p.url().includes('flow.google') || p.url().includes('labs.google')) ??
      pages[0] ??
      (await this.context.newPage());

    if (!this.page.url().includes('flow.google') && !this.page.url().includes('accounts.google')) {
      await this.page.goto(options.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    // Aguardar carregamento da SPA do Google Flow (ate 12s)
    for (let i = 0; i < 12; i++) {
      const curUrl = this.page.url();
      if (curUrl.includes('accounts.google.com')) break;
      const hasUi = await this.page
        .locator('textarea, [role="textbox"], button')
        .count()
        .catch(() => 0);
      if (hasUi > 2) break;
      await this.page.waitForTimeout(1000);
    }
    await this.page.waitForTimeout(2000);
    return this.captureSerializablePageState();
  }

  public async captureSerializablePageState(): Promise<SimulatedPageState> {
    if (!this.page) {
      throw new Error('Sessao Playwright nao inicializada.');
    }

    const url = this.page.url();
    const viewport = this.page.viewportSize() ?? { width: 1920, height: 1080 };
    const projectMatch = url.match(/\/project\/([a-f0-9-]{10,})/i);
    const projectContextId = projectMatch?.[1] ?? '560389d6-0558-4e65-8946-e48a2b12b453';

    const bodyText = (await this.page.locator('body').innerText().catch(() => '')) ?? '';
    const isLoginUrl = url.includes('accounts.google.com');
    const challengeCount = await this.page
      .locator('iframe[src*="recaptcha/api2/bframe"]:visible, iframe[src*="recaptcha/enterprise/bframe"]:visible')
      .count()
      .catch(() => 0);
    const hasCaptcha = bodyText.includes('unusual traffic') || challengeCount > 0;

    const controls: SimulatedDomControl[] = [];

    // 1. Prompt Input ("O que você quer criar?")
    const promptLocator = this.page
      .locator('textarea:visible, [role="textbox"]:visible, [contenteditable="true"]:visible')
      .first();
    const promptVisible = await promptLocator.isVisible().catch(() => false);
    const promptEnabled = promptVisible
      ? await promptLocator.isEnabled().catch(() => true)
      : false;
    const promptValue = promptVisible
      ? ((await promptLocator.inputValue().catch(async () => promptLocator.innerText())) ?? '').trim()
      : '';

    controls.push({
      controlId: 'ctrl_prompt_input',
      containerId: 'composer_root',
      role: 'textbox',
      name: 'O que você quer criar?',
      placeholder: 'O que você quer criar?',
      visible: promptVisible,
      enabled: promptEnabled,
      matchesCount: promptVisible ? 1 : 0,
      currentValue: promptValue,
    });

    // 2. Seletor de Modelo / Proporcao / Quantidade (ex: "Nano Banana 2.1 x2" ou "Veo")
    const modelLocator = this.page
      .locator('button:visible, [role="button"]:visible')
      .filter({ hasText: /Nano Banana|Veo|x1|x2|x4/i })
      .first();
    const modelVisible = await modelLocator.isVisible().catch(() => false);
    const modelText = modelVisible
      ? ((await modelLocator.innerText().catch(() => 'Nano Banana 2.1 x2')) ?? '')
          .replace(/\s+/g, ' ')
          .trim()
      : 'Nano Banana 2.1 x2';

    controls.push({
      controlId: 'ctrl_model_selector',
      containerId: 'composer_toolbar',
      role: 'button',
      name: modelText || 'Nano Banana 2.1 x2',
      label: 'Model Selector',
      visible: modelVisible || promptVisible,
      enabled: true,
      matchesCount: 1,
      currentValue: modelText,
    });

    // 3. Botao Agente
    const agentLocator = this.page
      .locator('button:visible, [role="button"]:visible')
      .filter({ hasText: /Agente|Agent/i })
      .first();
    const agentVisible = await agentLocator.isVisible().catch(() => false);
    controls.push({
      controlId: 'ctrl_agent_toggle',
      containerId: 'composer_toolbar',
      role: 'button',
      name: 'Agente',
      visible: agentVisible || promptVisible,
      enabled: true,
      matchesCount: 1,
    });

    // 4. Aba Todas as midias
    const mediaTabLocator = this.page
      .locator('button:visible, [role="button"]:visible, a:visible')
      .filter({ hasText: /Todas as mídias|All media/i })
      .first();
    const mediaTabVisible = await mediaTabLocator.isVisible().catch(() => false);
    controls.push({
      controlId: 'ctrl_tab_all_media',
      containerId: 'sidebar_nav',
      role: 'button',
      name: 'Todas as mídias',
      visible: mediaTabVisible || promptVisible,
      enabled: true,
      matchesCount: 1,
    });

    // 5. Aba Cenas
    const scenesTabLocator = this.page
      .locator('button:visible, [role="button"]:visible, a:visible')
      .filter({ hasText: /Cenas|Scenes/i })
      .first();
    const scenesTabVisible = await scenesTabLocator.isVisible().catch(() => false);
    controls.push({
      controlId: 'ctrl_tab_scenes',
      containerId: 'sidebar_nav',
      role: 'button',
      name: 'Cenas',
      visible: scenesTabVisible || promptVisible,
      enabled: true,
      matchesCount: 1,
    });

    // 6. Botao Enviar (Gerar)
    controls.push({
      controlId: 'ctrl_submit',
      containerId: 'composer_root',
      role: 'button',
      name: 'Gerar',
      visible: promptVisible,
      enabled: promptVisible,
      matchesCount: promptVisible ? 1 : 0,
    });

    const isAuthenticated =
      !isLoginUrl &&
      !bodyText.includes('Fazer login') &&
      !bodyText.includes('Sign in') &&
      (url.includes('/project/') ||
        promptVisible ||
        bodyText.includes('Todas as mídias') ||
        bodyText.includes('Comece a criar') ||
        bodyText.includes('PRO'));

    const outputsMatch = modelText.match(/x(\d+)/i);
    const selectedOutputsCount = outputsMatch ? Number(outputsMatch[1]) : 2;

    return {
      url,
      locale: 'pt-BR',
      viewport,
      accountContextId: 'matosmayk9@gmail.com',
      projectContextId,
      creationMode: 'standard',
      observedVariant: 'flow-web-v2',
      isAuthenticated,
      hasCaptchaOrVerification: hasCaptcha,
      humanInterferenceDetected: false,
      selectedModel: modelText.replace(/\s*x\d+.*$/i, '').trim() || 'Nano Banana 2.1',
      selectedAspectRatio: '16:9',
      selectedOutputsCount,
      promptText: promptValue,
      uploadReadyFilename: null,
      observedRevision: 1,
      controls,
      results: [],
      isResultsVirtualizedOrPartial: false,
    };
  }

  public async fillPromptOnRealPageWithoutSubmitting(promptText: string): Promise<{
    filled: boolean;
    observedText: string;
  }> {
    if (!this.page) {
      throw new Error('Sessao Playwright nao inicializada.');
    }
    const locator = this.page
      .locator('textarea:visible, [role="textbox"]:visible, [contenteditable="true"]:visible')
      .first();
    await locator.click({ timeout: 8000 });
    await locator.fill(promptText, { timeout: 8000 });
    await this.page.waitForTimeout(500);
    const observedText = (
      (await locator.inputValue().catch(async () => locator.innerText())) ?? ''
    ).trim();
    return {
      filled: promptText === '' ? observedText === '' : observedText.includes(promptText),
      observedText,
    };
  }

  public async takeVerificationScreenshot(savePath: string): Promise<void> {
    if (!this.page) return;
    await this.page.screenshot({ path: savePath, fullPage: false });
  }

  public async disconnectKeepBrowserOpen(): Promise<void> {
    // Em conexoes CDP, browser.close() envia Browser.close e fecha o Chrome.
    // Mantemos a referencia nula para deixar a janela do navegador aberta para o operador.
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}
