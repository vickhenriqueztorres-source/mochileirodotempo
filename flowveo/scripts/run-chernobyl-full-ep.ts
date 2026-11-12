import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import { buildFlowMotionPromptFromStartFrame } from '../src/domain/media/flow-motion-prompt.js';
import {
  assertUniqueDownloadedTake,
  writeVerifiedConcatList,
} from '../src/domain/media/take-deduplicator.js';
import { buildSingleFullStoryShort } from '../src/domain/media/short-story-builder.js';

const PROJECT_ROOT = path.resolve('D:/CANAL 9/flowveo');
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'runtime');
const SF_CHERNOBYL_DIR = path.join(RUNTIME_DIR, 'start_frames_chernobyl');
const CHERNOBYL_TAKES_DIR = path.join(RUNTIME_DIR, 'artifacts', 'chernobyl_takes');
const EPISODIOS_DIR = path.resolve('D:/CANAL 9/storage_local/episodios');
const SHORTS_DIR = path.join(EPISODIOS_DIR, 'shorts');
const SPEC_PATH = path.join(RUNTIME_DIR, 'chernobyl_60_takes_spec.json');
const LOG_PATH = path.join(RUNTIME_DIR, 'chernobyl_runner.log');

interface ChernobylTakeSpec {
  take: number;
  scene: number;
  startFrame: string;
  motion: string;
  dialogue: string;
}

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_PATH, line + '\n', 'utf8');
  } catch {}
}

async function connectOrLaunchFlowBrowser(): Promise<Browser> {
  try {
    const b = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 30000 });
    log('[CDP 9222] Conectado ao Chrome existente na porta 9222.');
    return b;
  } catch {
    log('[CDP 9222] Iniciando Chrome persistente via WMI Win32_Process.Create na porta 9222...');
    const userDataDir = path.join(RUNTIME_DIR, 'profile');
    const chromeCmd = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="${userDataDir}" --no-first-run --no-default-browser-check "https://flow.google.com/"`;
    const psScript = `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='${chromeCmd.replace(/'/g, "''")}'} | Select-Object ReturnValue, ProcessId | ConvertTo-Json`;
    execFileSync('powershell', ['-NoProfile', '-Command', psScript], {
      encoding: 'utf8',
      windowsHide: true,
    });

    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const b = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 30000 });
        log('[CDP 9222] Chrome iniciado e conectado com sucesso.');
        return b;
      } catch {
        // aguardar porta 9222 subir
      }
    }
    throw new Error('Nao foi possivel iniciar/conectar ao Chrome na porta 9222');
  }
}

async function dismissAnyCdkBackdrop(page: Page): Promise<void> {
  const concordoBtn = page.locator('button:has-text("Concordo")').first();
  if (await concordoBtn.isVisible().catch(() => false)) {
    log('[Direitos de Imagem] Clicando em Concordo no modal de termos de upload...');
    await concordoBtn.click();
    await page.waitForTimeout(1000);
  }
  const backdrops = page.locator('.cdk-overlay-backdrop-showing');
  const count = await backdrops.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    await backdrops
      .first()
      .evaluate((el: HTMLElement) => el.click())
      .catch(() => undefined);
    await page.waitForTimeout(350);
  }
}

async function waitForLoginIfOnAccountsPage(page: Page): Promise<void> {
  for (let w = 0; w < 300; w++) {
    const u = page.url();
    if (
      !u.includes('accounts.google.com') &&
      (u.startsWith('https://flow.google.com') || u.startsWith('https://labs.google'))
    ) {
      return;
    }
    if (w % 5 === 0) {
      log(`[Login Google] Aguardando senha de vickhenriqueztorres@gmail.com na janela do Chrome...`);
    }
    await page.waitForTimeout(2000);
  }
  throw new Error('Timeout aguardando login no Google Flow');
}

async function switchFlowToVickAccount(page: Page): Promise<void> {
  log('[Switch Account] Navegando para AccountChooser para selecionar vickhenriqueztorres@gmail.com...');
  await page.goto('https://accounts.google.com/AccountChooser?continue=https://flow.google.com/', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(2500);

  const vickItem = page.locator('[data-identifier="vickhenriqueztorres@gmail.com"], :text("vickhenriqueztorres@gmail.com")').first();
  if (await vickItem.isVisible().catch(() => false)) {
    await vickItem.click();
    await page.waitForTimeout(3000);
  } else {
    const useAnother = page.locator(':text("Usar outra conta"), :text("Adicionar outra conta")').first();
    if (await useAnother.isVisible().catch(() => false)) {
      await useAnother.click();
      await page.waitForTimeout(2000);
    }
    const emailInput = page.locator('input[type="email"], input#identifierId').first();
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill('vickhenriqueztorres@gmail.com');
      await page.waitForTimeout(400);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2500);
    }
  }

  await waitForLoginIfOnAccountsPage(page);
  await page.waitForTimeout(3500);
}

async function ensureInsideFlowProject(page: Page): Promise<void> {
  await waitForLoginIfOnAccountsPage(page);
  await dismissAnyCdkBackdrop(page);

  log(`[Check URL] URL atual da aba: ${page.url()}`);

  if (page.url().includes('/project/')) {
    const warnBtn = page.locator('button[aria-label="Alerta de créditos insuficientes"]').first();
    if (await warnBtn.isVisible().catch(() => false)) {
      log('[Conta sem creditos detectada] Trocando para vickhenriqueztorres@gmail.com...');
      await switchFlowToVickAccount(page);
    } else {
      return;
    }
  }

  await dismissAnyCdkBackdrop(page);

  if (page.url().includes('/project/')) {
    return;
  }

  log(`[Flow Home] URL atual: ${page.url()} — procurando botao Novo projeto...`);
  const novoProjetoBtn = page.locator('button:has-text("Novo projeto")').first();
  await novoProjetoBtn.waitFor({ state: 'visible', timeout: 25000 });
  await novoProjetoBtn.click();

  await page.waitForURL('**/project/**', { timeout: 30000 });
  await page.waitForTimeout(3500);
  log(`[Flow Project Aberto]: ${page.url()}`);
}

async function scrollGridToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const scrollers = Array.from(document.querySelectorAll('*')).filter(
      (el) => el.scrollHeight > el.clientHeight + 50 && el.scrollTop > 0
    );
    for (const s of scrollers) {
      s.scrollTop = 0;
    }
  });
}

async function closeAnyModalAndFilterVideos(page: Page): Promise<void> {
  await dismissAnyCdkBackdrop(page);

  const concluirBtn = page
    .locator('button[aria-label="Edição da cena concluída"], button:has-text("Concluir")')
    .first();
  if (await concluirBtn.isVisible().catch(() => false)) {
    await concluirBtn.evaluate((el: HTMLElement) => el.click());
    await concluirBtn.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  }

  await dismissAnyCdkBackdrop(page);

  const videosTab = page.locator('button:has-text("Vídeos")').first();
  if (await videosTab.isVisible().catch(() => false)) {
    await videosTab.evaluate((el: HTMLElement) => el.click());
    await page.waitForTimeout(800);
  }
  await scrollGridToTop(page);
}

async function ensureVideoFramesMode(page: Page): Promise<void> {
  await dismissAnyCdkBackdrop(page);

  const agentCheckedBtn = page.locator('button.agent-mode-chip-checked').first();
  if (await agentCheckedBtn.isVisible().catch(() => false)) {
    log('[Modo Agente] Desativando agent-mode-chip-checked...');
    await agentCheckedBtn.click();
    await page.waitForTimeout(900);
  }

  const triggerBtn = page.locator('button[aria-label="Gatilho de configurações"]').first();
  await triggerBtn.waitFor({ state: 'visible', timeout: 15000 });
  const triggerText = (await triggerBtn.innerText().catch(() => '')).replace(/\s+/g, ' ');
  const swapFramesBtn = page
    .locator('button[aria-label="Trocar o primeiro e o último frame"]')
    .first();

  if (
    triggerText.includes('Vídeo') &&
    triggerText.includes('x1') &&
    (await swapFramesBtn.isVisible().catch(() => false))
  ) {
    return;
  }

  await triggerBtn.click();
  await page.waitForTimeout(800);
  await page.locator('button[role="radio"]:has-text("Vídeo")').first().click().catch(() => undefined);
  await page.waitForTimeout(500);
  await page.locator('button[role="radio"]:has-text("Frames")').first().click().catch(() => undefined);
  await page.waitForTimeout(500);
  await page.locator('button[role="radio"]:has-text("16:9")').first().click().catch(() => undefined);
  await page.waitForTimeout(400);
  await page.locator('button[role="radio"]:has-text("8s")').first().click().catch(() => undefined);
  await page.waitForTimeout(400);
  await page.locator('button[role="radio"]:has-text("x1")').first().click().catch(() => undefined);
  await page.waitForTimeout(500);
  await dismissAnyCdkBackdrop(page);
  await page.waitForTimeout(500);
}

async function acceptImageRightsIfVisible(page: Page): Promise<boolean> {
  const concordoBtn = page.locator('button:has-text("Concordo")').first();
  if (await concordoBtn.isVisible().catch(() => false)) {
    log('[Direitos de Imagem] Clicando em Concordo no modal de termos de upload...');
    await concordoBtn.click();
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
}

async function attachStartFrameToInicio(page: Page, startFrameFile: string): Promise<void> {
  await acceptImageRightsIfVisible(page);
  await dismissAnyCdkBackdrop(page);

  const sfAbsPath = path.join(SF_CHERNOBYL_DIR, startFrameFile);
  const inicioBtn = page.locator('button.empty-chip:has-text("Início"), button:has-text("Início")').first();

  if (!(await inicioBtn.isVisible().catch(() => false))) {
    const clearBtn = page.locator('button[aria-label="Apagar comando"]').first();
    if (await clearBtn.isVisible().catch(() => false)) {
      await clearBtn.evaluate((el: HTMLElement) => el.click());
      await page.waitForTimeout(700);
    }
    const cancelChip = page.locator('button.chip-container:has-text("cancel")').first();
    if (!(await inicioBtn.isVisible().catch(() => false)) && (await cancelChip.isVisible().catch(() => false))) {
      await cancelChip.evaluate((el: HTMLElement) => el.click());
      await page.waitForTimeout(700);
    }
  }

  if (await inicioBtn.isVisible().catch(() => false)) {
    await inicioBtn.click();
    await page.waitForTimeout(800);
  }

  await acceptImageRightsIfVisible(page);

  const assetLocator = page
    .locator(`button.asset-item:has-text("${startFrameFile}")`)
    .filter({ hasNotText: 'Enviando' })
    .first();

  if (!(await assetLocator.isVisible().catch(() => false))) {
    const uploadBtn = page
      .locator('button.sidebar-upload-btn, button:has-text("Enviar mídia")')
      .first();
    await uploadBtn.waitFor({ state: 'visible', timeout: 10000 });

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15000 }),
      uploadBtn.click(),
    ]);
    await fileChooser.setFiles(sfAbsPath);
    await page.waitForTimeout(1000);
    await acceptImageRightsIfVisible(page);

    for (let w = 0; w < 45; w++) {
      await acceptImageRightsIfVisible(page);
      if (await assetLocator.isVisible().catch(() => false)) {
        break;
      }
      await page.waitForTimeout(1000);
    }
    await assetLocator.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600);
  }

  const isActive = await assetLocator
    .evaluate((el) => el.classList.contains('asset-item-active'))
    .catch(() => false);
  if (!isActive) {
    await assetLocator.click();
    await page.waitForTimeout(700);
  }

  const incluirBtn = page
    .locator(
      'button.detail-add-to-prompt-btn:not([disabled]), button:has-text("Incluir no comando"):not([disabled])'
    )
    .first();
  await incluirBtn.waitFor({ state: 'visible', timeout: 10000 });
  await incluirBtn.click();
  await page.waitForTimeout(1000);
}

function getDownloadedTakeCount(): number {
  let count = 0;
  for (let t = 1; t <= 60; t++) {
    const p = path.join(CHERNOBYL_TAKES_DIR, `take_${String(t).padStart(2, '0')}.mp4`);
    if (fs.existsSync(p) && fs.statSync(p).size > 500_000) {
      count++;
    }
  }
  return count;
}

function assembleMasterAndShorts(): void {
  const allTakePaths: string[] = [];
  for (let t = 1; t <= 60; t++) {
    const p = path.join(CHERNOBYL_TAKES_DIR, `take_${String(t).padStart(2, '0')}.mp4`);
    if (fs.existsSync(p) && fs.statSync(p).size > 500_000) {
      allTakePaths.push(p);
    }
  }
  if (allTakePaths.length === 0) return;

  const concatListPath = path.join(CHERNOBYL_TAKES_DIR, 'concat_60_takes.txt');
  writeVerifiedConcatList(allTakePaths, concatListPath);

  const masterEpPath = path.join(EPISODIOS_DIR, 'EP01_CHERNOBYL_1986_COMPLETO_PTBR_MASTER.mp4');
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c:v',
      'copy',
      '-af',
      'aresample=async=1:first_pts=0',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      masterEpPath,
    ],
    { stdio: 'ignore', windowsHide: true }
  );
  log(
    `[MASTER ATUALIZADO (${allTakePaths.length}/60 takes | ~${allTakePaths.length * 8}s)]: ${masterEpPath}`
  );
}

async function downloadSingleThumbnail(
  page: Page,
  browserSession: CDPSession,
  thumbIdx: number,
  takeNum: number
): Promise<void> {
  const padTake = String(takeNum).padStart(2, '0');
  const dstPath = path.join(CHERNOBYL_TAKES_DIR, `take_${padTake}.mp4`);

  const dlBtn = page
    .locator('button[aria-label="Baixar mídia"], button[aria-label="Fazer o download"]')
    .first();
  const backBtn = page
    .locator('button[aria-label="Edição da cena concluída"], button:has-text("Concluir")')
    .first();

  log(`[Baixando Take ${padTake}/60 <- miniatura nth(${thumbIdx})...]`);

  let modalOpened = false;
  for (let attempt = 1; attempt <= 4; attempt++) {
    await dismissAnyCdkBackdrop(page);
    if (await backBtn.isVisible().catch(() => false)) {
      await backBtn.evaluate((el: HTMLElement) => el.click());
      await backBtn.waitFor({ state: 'hidden', timeout: 6000 }).catch(() => undefined);
      await page.waitForTimeout(800);
    }
    await scrollGridToTop(page);
    await page.waitForTimeout(500);

    const thumb = page.locator('img[alt="Miniatura do vídeo gerada"]').nth(thumbIdx);
    await thumb.evaluate((el: HTMLElement) => {
      el.scrollIntoView({ block: 'center' });
      el.click();
    });

    try {
      await dlBtn.waitFor({ state: 'visible', timeout: 6000 });
      modalOpened = true;
      break;
    } catch {
      log(`  [Retry ${attempt}/4 abrindo miniatura nth(${thumbIdx}) para Take ${padTake}...]`);
      await page.waitForTimeout(1000);
    }
  }

  if (!modalOpened) {
    throw new Error(`Nao foi possivel abrir o modal de detalhe para Take ${padTake} (nth ${thumbIdx})`);
  }

  const downloadDone = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout download Take ${padTake}`)), 45000);
    let suggested = '';
    const onBegin = (ev: { suggestedFilename: string }) => {
      suggested = ev.suggestedFilename;
    };
    const onProgress = (ev: { state: string }) => {
      if (ev.state === 'completed') {
        clearTimeout(timer);
        browserSession.off('Browser.downloadWillBegin', onBegin);
        browserSession.off('Browser.downloadProgress', onProgress);
        resolve(suggested);
      }
    };
    browserSession.on('Browser.downloadWillBegin', onBegin);
    browserSession.on('Browser.downloadProgress', onProgress);
  });

  await dlBtn.evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(900);

  const item720 = page.locator('[role="menuitem"]:has-text("720p")').first();
  await item720.waitFor({ state: 'visible', timeout: 10000 });
  await item720.evaluate((el: HTMLElement) => el.click());

  const downloadedName = await downloadDone;
  const rawDownloadedPath = path.join(CHERNOBYL_TAKES_DIR, downloadedName);
  if (fs.existsSync(rawDownloadedPath)) {
    assertUniqueDownloadedTake({
      candidatePath: rawDownloadedPath,
      targetTakeNumber: takeNum,
      takesDir: CHERNOBYL_TAKES_DIR,
    });
    if (fs.existsSync(dstPath)) fs.unlinkSync(dstPath);
    fs.renameSync(rawDownloadedPath, dstPath);
  }
  log(
    `[Take ${padTake}/60 Salvo]: ${dstPath} (${(fs.statSync(dstPath).size / 1024 / 1024).toFixed(2)} MB)`
  );

  if (await backBtn.isVisible().catch(() => false)) {
    await backBtn.evaluate((el: HTMLElement) => el.click());
    await backBtn.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
  }
}

async function submitAndDownloadBatch(
  page: Page,
  browserSession: CDPSession,
  batch: ChernobylTakeSpec[]
): Promise<void> {
  const pendingTakes = batch.filter((b) => {
    const p = path.join(CHERNOBYL_TAKES_DIR, `take_${String(b.take).padStart(2, '0')}.mp4`);
    return !fs.existsSync(p) || fs.statSync(p).size <= 500_000;
  });

  if (pendingTakes.length === 0) {
    return;
  }

  await ensureInsideFlowProject(page);
  await closeAnyModalAndFilterVideos(page);
  await ensureVideoFramesMode(page);
  await scrollGridToTop(page);
  await page.waitForTimeout(500);

  const firstThumb = page.locator('img[alt="Miniatura do vídeo gerada"]').first();
  const prevTopSrc =
    (await firstThumb.getAttribute('src').catch(() => null)) ?? '__NONE__';

  log(
    `=== Submetendo lote de ${pendingTakes.length} takes (Takes ${pendingTakes.map((t) => t.take).join(', ')}) | Total no disco: ${getDownloadedTakeCount()}/60 ===`
  );

  const submittedTakes: ChernobylTakeSpec[] = [];

  for (const item of pendingTakes) {
    const padTake = String(item.take).padStart(2, '0');
    const built = buildFlowMotionPromptFromStartFrame({
      rawMotionPrompt: item.motion,
      ptBrDialogue: item.dialogue,
    });

    log(`[Submetendo Take ${padTake}/60 | Cena ${item.scene} | ${item.startFrame}]`);
    await attachStartFrameToInicio(page, item.startFrame);

    const promptBox = page.locator('[role="textbox"][aria-label="O que você quer criar?"]').first();
    await promptBox.click();
    await promptBox.fill(built.promptText);
    await page.waitForTimeout(700);

    const submitBtn = page.locator('button[aria-label="Iniciar geração"]:not([disabled])').first();
    const canSubmit = await submitBtn
      .waitFor({ state: 'visible', timeout: 12000 })
      .then(() => true)
      .catch(() => false);

    if (!canSubmit) {
      log(
        `  [Aviso] Botao Iniciar geração indisponivel no Take ${padTake}; processando os ${submittedTakes.length} ja enviados neste lote.`
      );
      break;
    }

    await submitBtn.click();
    submittedTakes.push(item);
    await page.waitForTimeout(4800);
  }

  if (submittedTakes.length === 0) {
    return;
  }

  const closeDrawerBtn = page.locator('button:has-text("left_panel_close")').first();
  if (await closeDrawerBtn.isVisible().catch(() => false)) {
    await closeDrawerBtn.click().catch(() => undefined);
    await page.waitForTimeout(500);
  }

  let newReadyCount = 0;
  let stablePolls = 0;
  let lastSeenCount = 0;

  for (let poll = 0; poll < 75; poll++) {
    await scrollGridToTop(page);
    const status = await page.evaluate((markerSrc) => {
      const imgs = Array.from(
        document.querySelectorAll('img[alt="Miniatura do vídeo gerada"]')
      );
      const srcs = imgs.map((img) => img.getAttribute('src') || '');
      let ready = srcs.length;
      if (markerSrc !== '__NONE__') {
        const idx = srcs.indexOf(markerSrc);
        ready = idx === -1 ? srcs.length : idx;
      }
      const bodyText = document.body.innerText || '';
      const activePctMatches = bodyText.match(/\b\d{1,2}%/g) || [];
      return { ready, activeCount: activePctMatches.length };
    }, prevTopSrc);

    newReadyCount = status.ready;
    log(
      `[Lote Poll ${poll + 1}/75] Prontos no topo: ${newReadyCount}/${submittedTakes.length} (gerando: ${status.activeCount})`
    );

    if (newReadyCount >= submittedTakes.length) {
      break;
    }
    if (newReadyCount > 0 && status.activeCount === 0 && newReadyCount === lastSeenCount) {
      stablePolls += 1;
      if (stablePolls >= 6 && poll >= 12) {
        log(
          `Aviso: ${newReadyCount}/${submittedTakes.length} prontos e 0 gerando; baixando prontos.`
        );
        break;
      }
    } else {
      stablePolls = 0;
      lastSeenCount = newReadyCount;
    }
    await page.waitForTimeout(4000);
  }

  const countToDownload = Math.min(newReadyCount, submittedTakes.length);
  for (let i = 0; i < countToDownload; i++) {
    const thumbIdx = countToDownload - 1 - i;
    const takeObj = submittedTakes[i];
    await downloadSingleThumbnail(page, browserSession, thumbIdx, takeObj.take);
  }

  assembleMasterAndShorts();
}

export async function main() {
  fs.mkdirSync(SF_CHERNOBYL_DIR, { recursive: true });
  fs.mkdirSync(CHERNOBYL_TAKES_DIR, { recursive: true });
  fs.mkdirSync(EPISODIOS_DIR, { recursive: true });
  fs.mkdirSync(SHORTS_DIR, { recursive: true });
  fs.writeFileSync(LOG_PATH, `=== INICIANDO RUNNER CHERNOBYL (${getDownloadedTakeCount()}/60 no disco) ===\n`, 'utf8');

  try {
    fs.unlinkSync(path.resolve('D:/CANAL 9/flowveo/scripts/open-vick-login.ts'));
  } catch {}
  try {
    fs.unlinkSync(path.resolve('D:/CANAL 9/flowveo/scripts/check-accounts.ts'));
  } catch {}

  const specs: ChernobylTakeSpec[] = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));

  const browser = await connectOrLaunchFlowBrowser();
  const allPages = browser.contexts().flatMap((c) => c.pages());
  const page =
    allPages.find((p) => p.url().includes('pli=1')) ??
    allPages.find((p) => p.url().includes('flow.google.com')) ??
    allPages[0];
  if (!page) throw new Error('Nenhuma aba encontrada na porta 9222');
  for (const other of allPages) {
    if (other !== page) {
      await other.close().catch(() => undefined);
    }
  }
  await page.bringToFront();

  const browserSession = await browser.newBrowserCDPSession();
  await browserSession.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: CHERNOBYL_TAKES_DIR,
    eventsEnabled: true,
  });

  await ensureInsideFlowProject(page);

  const BATCH_SIZE = 4;
  for (let pass = 1; pass <= 3; pass++) {
    if (getDownloadedTakeCount() >= specs.length) break;
    log(`================ PASSAGEM ${pass}/3 (Baixados: ${getDownloadedTakeCount()}/60) ================`);
    for (let i = 0; i < specs.length; i += BATCH_SIZE) {
      const batch = specs.slice(i, i + BATCH_SIZE);
      await submitAndDownloadBatch(page, browserSession, batch);
    }
  }

  assembleMasterAndShorts();

  const shortResult = await buildSingleFullStoryShort({
    episodeSlug: 'CHERNOBYL_1986',
    takesDir: CHERNOBYL_TAKES_DIR,
    shortsOutDir: SHORTS_DIR,
    strategicTakeNumbers: [1, 19, 28, 31, 41, 43, 60],
    topBadgeText: '26 DE ABRIL DE 1986 • 01:23 AM',
    titleLine1: 'VIAJEI PARA CHERNOBYL',
    titleLine2: '8 MIN ANTES DA EXPLOSÃO',
    subtitleLine: 'Da Sala de Controle ao Feixe Azul do Reator 4',
    youtubeMetadata: {
      title:
        'Viajei no Tempo para CHERNOBYL em 1986: Da Sala de Controle até a Explosão do Reator 4 #shorts',
      description:
        '26 de abril de 1986, 01h23m40s. A história completa de Chernobyl do início ao fim: da chegada em Pripyat e o acionamento do botão AZ-5 até os blocos de grafite e o feixe azul de radiação Cherenkov. Assista ao episódio completo de 8 minutos no canal! #chernobyl #viagemnotempo #historia #shorts',
      tags: [
        'chernobyl',
        'chernobyl 1986',
        'viajei no tempo para chernobyl',
        'viagem no tempo',
        'botao az5',
        'feixe azul chernobyl',
        'reator 4',
        'historia',
        'shorts',
      ],
    },
    purgeLegacyFragmentedShorts: true,
  });
  log(
    `[SHORT UNICO HISTORIA COMPLETA SALVO]: ${shortResult.shortVideoPath} (${shortResult.durationSec}s | ${shortResult.sizeMB} MB)`
  );

  log(`=== CONCLUIDO: ${getDownloadedTakeCount()}/60 takes ===`);
  process.exit(0);
}

main().catch((err) => {
  log(`ERRO NO RUNNER DE CHERNOBYL: ${err?.stack || err}`);
  process.exit(1);
});
