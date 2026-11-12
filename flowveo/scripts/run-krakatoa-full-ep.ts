import { execFileSync, spawn } from 'node:child_process';
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
const SF_KRAKATOA_DIR = path.join(RUNTIME_DIR, 'start_frames_krakatoa');
const KRAKATOA_TAKES_DIR = path.join(RUNTIME_DIR, 'artifacts', 'krakatoa_takes');
const EPISODIOS_DIR = path.resolve('D:/CANAL 9/storage_local/episodios');
const SHORTS_DIR = path.join(EPISODIOS_DIR, 'shorts');
const THUMBS_DIR = path.join(EPISODIOS_DIR, 'thumbnails');
const ARTIFACT_DIR = path.resolve(
  'C:/Users/brend/.gemini/antigravity/brain/867cb782-904b-4b01-94d3-9e25fcbc7a95'
);
const SPEC_PATH = path.join(RUNTIME_DIR, 'krakatoa_62_takes_spec.json');
const LOG_PATH = path.join(RUNTIME_DIR, 'krakatoa_runner.log');
const TOTAL_TAKES = 62;

interface KrakatoaTakeSpec {
  take: number;
  scene: number;
  startFrame: string;
  motion: string;
  dialogue: string;
}

const CHARACTER_START_FRAME_PREFIX =
  'Raw authentic iPhone 15 Pro 0.5x ultra-wide selfie photo (16:9 widescreen, deep f/2.2 DOF, everything in focus from foreground to distant horizon, zero artificial bokeh, zero text overlays, zero watermarks). Slight high-angle handheld selfie with right arm extended holding camera outside frame. EXACT SAME 25-year-old European male backpacker: blue-grey eyes (#6C8494), straight dark eyebrows, neat short brown mustache (#3A2A1D) with 1-day light chin stubble, natural fair skin with subtle wind pinkness. Wearing washed dark navy-blue cap (#263340) worn forward with NO logo, matte burnt-terracotta Gore-Tex hardshell jacket (#9E472A) zipped over black inner fleece collar, dark charcoal backpack shoulder straps (#2B2E33) buckled across chest with blue hydration tube, and warm mustard-ochre yellow backpack rain cover (#D99B26) peaking behind his shoulders.';

const START_FRAME_PROMPTS: ReadonlyArray<{ file: string; sceneDesc: string }> = [
  {
    file: 'sf_kr_01_praia_anjer_ceu_escuro.jpg',
    sceneDesc:
      'Standing on the black volcanic sand beach of Anjer (Java coast, Sunda Strait, August 27, 1883, 09:40 AM) under an eerie pitch-dark morning sky filled with falling grey volcanic ash, wooden Javanese outrigger boats on the shore, and a red volcanic glow on the distant sea horizon.',
  },
  {
    file: 'sf_kr_02_farol_quarto_ponto_colonial.jpg',
    sceneDesc:
      'Standing in front of the massive 40-meter white Dutch colonial Fourth Point Lighthouse on the rocky coast of Anjer while its oil lamp shines a bright beam through dark falling grey volcanic ash at 09:45 AM.',
  },
  {
    file: 'sf_kr_03_porto_holandes_telegrafo.jpg',
    sceneDesc:
      'Standing on the muddy 1883 Dutch colonial port street of Anjer in front of the telegraph office while colonial clerks in ash-dusted white linen suits and Javanese sailors hold glowing oil lanterns in the eerie daytime darkness.',
  },
  {
    file: 'sf_kr_04_ilha_krakatoa_horizonte_fogo.jpg',
    sceneDesc:
      'Standing at the tip of the old stone jetty of Anjer; behind him across the dark waters of the Sunda Strait, the distant island of Krakatoa erupts with blood-red magma fountains and a colossal 30km black ash column.',
  },
  {
    file: 'sf_kr_05_relampagos_vulcanicos_roxos.jpg',
    sceneDesc:
      'Standing on the coastal pier of Anjer looking shocked into the lens while behind him over the sea dozens of jagged purple, violet, and orange volcanic lightning bolts rip across the massive black eruption plume of Krakatoa.',
  },
  {
    file: 'sf_kr_06_chuva_pedra_pomes_quente.jpg',
    sceneDesc:
      'Standing on a colonial street in Anjer as steaming grey porous pumice stones and black volcanic mud rain down; behind him 1883 villagers hold wooden planks over their heads under oil-lit verandas.',
  },
  {
    file: 'sf_kr_07_barometros_bussola_louca.jpg',
    sceneDesc:
      'Standing under the wooden porch of the 1883 Dutch harbor master office; right beside his shoulder on the wall, a vintage brass mercury barometer and nautical compass are lit by a warm oil lantern while dark ash swirls outside.',
  },
  {
    file: 'sf_kr_08_clarao_detonacao_10h02.jpg',
    sceneDesc:
      '10:02 AM cataclysmic detonation of Krakatoa: behind the backpacker on the Anjer waterfront, a blinding white-orange thermonuclear-scale volcanic explosion illuminates the entire pitch-black Sunda Strait and forms a giant white Wilson condensation shockwave dome over the sea.',
  },
  {
    file: 'sf_kr_09_silencio_antes_onda_choque.jpg',
    sceneDesc:
      'Bracing against a colonial stone wall in Anjer, pressing his left palm firmly over his ear with mouth open while across the bay a visible white supersonic shockwave ring races over the dark water toward the shore.',
  },
  {
    file: 'sf_kr_10_som_310_decibeis_impacto.jpg',
    sceneDesc:
      'The 310-decibel shockwave impacts Anjer: the backpacker winces in shock as every glass window and wooden shutter of the 1883 Dutch colonial buildings behind him shatters outward in a blast of grey volcanic dust and flying roof tiles.',
  },
  {
    file: 'sf_kr_11_ceu_rachado_pressao_atmosferica.jpg',
    sceneDesc:
      'Standing in the debris-strewn colonial street of Anjer looking up; above the shattered roofs, the atmospheric shockwave has punched a dramatic circular ring opening through the dark volcanic ash clouds while stunned 1883 sailors hold their ears.',
  },
  {
    file: 'sf_kr_12_mar_recuando_recife_seco.jpg',
    sceneDesc:
      'Standing at the stone seawall of Anjer harbor; behind him, the entire ocean has receded hundreds of meters, leaving 19th-century wooden Dutch sailing ships and boats stranded sideways on exposed coral reefs and steaming black mud.',
  },
  {
    file: 'sf_kr_13_navio_berouw_arrastado.jpg',
    sceneDesc:
      'Near the shore looking back in terror as a colossal 40-meter-high black tsunami wall crowned with churning white foam surges across the Sunda Strait under purple volcanic lightning, lifting a 19th-century steamship on its crest.',
  },
  {
    file: 'sf_kr_14_corrida_estrada_palmeiras.jpg',
    sceneDesc:
      'Dynamic handheld selfie sprinting up a muddy jungle hill road lined with bending tropical palm trees as gale-force ash winds blow and the massive black tsunami wall approaches the coast below behind him.',
  },
  {
    file: 'sf_kr_15_queda_farol_gigante_aco.jpg',
    sceneDesc:
      'From a hillside vantage point looking into the lens while behind him below on the coast, the monstrous 40-meter black tsunami wave slams directly into the white Fourth Point Lighthouse, snapping the giant stone-and-iron tower in half.',
  },
  {
    file: 'sf_kr_16_onda_engolindo_porto_anjer.jpg',
    sceneDesc:
      'From a high ridge overlooking Anjer, filming as the churning black tsunami floodwaters completely swallow the Dutch colonial harbor below, with wooden roofs, boats, and palm trees swirling in the dark torrent.',
  },
  {
    file: 'sf_kr_17_segunda_onda_subindo_encosta.jpg',
    sceneDesc:
      'On the steep jungle slope, scrambling up over muddy tree roots and volcanic rocks as churning black water thick with floating grey pumice stones surges up the hillside just meters below him.',
  },
  {
    file: 'sf_kr_18_escuridao_total_cinza_sufocante.jpg',
    sceneDesc:
      'On the hilltop at 10:30 AM in pitch-black volcanic darkness, his navy cap, eyebrows, and burnt-terracotta jacket heavily coated in grey volcanic ash while purple and green electrostatic lightning glows inside the ash clouds behind him.',
  },
  {
    file: 'sf_kr_19_vista_ilha_desaparecida_mar_pomes.jpg',
    sceneDesc:
      'From the coastal peak as the smoke parts slightly, behind the ash-dusted backpacker the entire Sunda Strait is covered in a solid thick grey carpet of floating pumice stones, and in the distance two-thirds of Krakatoa island has collapsed into a smoking sea caldera.',
  },
  {
    file: 'sf_kr_20_salto_emergencia_colina_krakatoa.jpg',
    sceneDesc:
      'On the dark ash-covered hilltop overlooking the smoking Sunda Strait and volcanic lightning, bright blue electrostatic time-travel energy crackles around his left wrist device and illuminates his face and burnt-terracotta jacket right before his temporal jump.',
  },
];

const THUMBNAIL_PROMPTS: ReadonlyArray<{ file: string; artifactName: string; prompt: string }> = [
  {
    file: 'THUMB_01_KRAKATOA_EXPLOSAO_OUVIDOS.jpg',
    artifactName: 'thumb_01_krakatoa_explosao_ouvidos.jpg',
    prompt:
      '16:9 YouTube Thumbnail in photorealistic raw iPhone 15 Pro ultra-wide style: Center-framed 25-year-old European male backpacker (blue-grey eyes, neat short brown mustache with 1-day stubble, washed dark navy-blue cap #263340 with no logo, matte burnt-terracotta Gore-Tex jacket #9E472A, charcoal chest straps, yellow backpack cover #D99B26) looking straight into the lens in extreme shock, pressing one hand to his ear against the 310-decibel blast and pointing back with his thumb at the colossal exploding Krakatoa volcano with purple/orange volcanic lightning + a giant 40-meter tsunami wave surging toward the shore + fleeing 1883 colonial sailors. At the top-center, giant bold 3D bevelled metallic cream-gold text with heavy black drop-shadow stacked on two lines: "KRAKATOA" on top and "1883" below.',
  },
  {
    file: 'THUMB_02_KRAKATOA_SELFIE_TSUNAMI_FAROL.jpg',
    artifactName: 'thumb_02_krakatoa_selfie_tsunami_farol.jpg',
    prompt:
      '16:9 YouTube Thumbnail in photorealistic raw iPhone 15 Pro 0.5x selfie style: The 25-year-old European male backpacker (blue-grey eyes, neat short brown mustache with 1-day stubble, washed dark navy-blue cap #263340 with no logo, matte burnt-terracotta Gore-Tex jacket #9E472A, charcoal chest straps, yellow backpack cover #D99B26) in the lower-left foreground with his right arm extended holding the camera, looking wide-eyed as behind him on the right a monstrous 40-meter black tsunami wave snaps the white Dutch colonial lighthouse in half while Krakatoa erupts with red lava and purple lightning in the background. In the upper-left sky, giant bold 3D bevelled metallic cream-gold text with heavy black drop-shadow stacked on two lines: "KRAKATOA" on top and "1883" below.',
  },
  {
    file: 'THUMB_03_KRAKATOA_ONDA_CHOQUE_310DB.jpg',
    artifactName: 'thumb_03_krakatoa_onda_choque_310db.jpg',
    prompt:
      '16:9 YouTube Thumbnail in photorealistic raw iPhone 15 Pro ultra-wide style: High-contrast dramatic composition with the 25-year-old European male backpacker (blue-grey eyes, neat short brown mustache with 1-day stubble, washed dark navy-blue cap #263340 with no logo, matte burnt-terracotta Gore-Tex jacket #9E472A, charcoal chest straps, yellow backpack cover #D99B26) in the foreground of an 1883 Dutch colonial port street as a visible white sonic shockwave dome expands from the erupting volcano across the bay, shattering every glass window around him while purple volcanic lightning fills the dark sky. At the top-center, giant bold 3D bevelled metallic cream-gold text with heavy black drop-shadow stacked on two lines: "KRAKATOA" on top and "1883" below.',
  },
];

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_PATH, line + '\n', 'utf8');
  } catch {}
}

function convertAndResizeJpg(rawBytes: Buffer, dstPath: string, width: number, height: number): void {
  const tmpRaw = `${dstPath}.raw`;
  fs.writeFileSync(tmpRaw, rawBytes);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      tmpRaw,
      '-vf',
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
      '-q:v',
      '2',
      dstPath,
    ],
    { stdio: 'ignore', windowsHide: true }
  );
  try {
    fs.unlinkSync(tmpRaw);
  } catch {}
}

async function connectOrLaunchFlowBrowser(): Promise<Browser> {
  try {
    const b = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 3000 });
    log('[CDP 9222] Conectado ao Chrome existente na porta 9222.');
    return b;
  } catch {
    log('[CDP 9222] Iniciando Chrome via spawn detached na porta 9222...');
    const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const userDataDir = path.join(RUNTIME_DIR, 'profile');
    const lockFile = path.join(userDataDir, 'SingletonLock');
    if (fs.existsSync(lockFile)) {
      try {
        fs.unlinkSync(lockFile);
      } catch {}
    }
    const child = spawn(
      chromeExe,
      [
        '--remote-debugging-port=9222',
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        'https://flow.google.com/project/59ebeb1d-63f2-43f9-a6b0-78b86c19fa88',
      ],
      { detached: true, stdio: 'ignore', windowsHide: false }
    );
    child.unref();

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const b = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 5000 });
        log('[CDP 9222] Chrome iniciado e conectado com sucesso.');
        return b;
      } catch {}
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
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(250);
}

async function ensureInsideFlowProject(page: Page, forceNewProject = false): Promise<void> {
  if (forceNewProject) {
    log('[Flow] Criando novo projeto limpo para manter o grid e a sidebar rapidos...');
    await page.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    await dismissAnyCdkBackdrop(page);
    const novoBtn = page.locator('button:has-text("Novo projeto")').first();
    await novoBtn.waitFor({ state: 'visible', timeout: 25000 });
    await novoBtn.click();
    await page.waitForURL('**/project/**', { timeout: 30000 });
    await page.waitForTimeout(3000);
    log(`[Novo Projeto Flow Aberto]: ${page.url()}`);
  } else if (!page.url().includes('/project/')) {
    await page.goto('https://flow.google.com/project/59ebeb1d-63f2-43f9-a6b0-78b86c19fa88', {
      waitUntil: 'domcontentloaded',
    });
  }
  await page
    .locator('button.agent-mode-chip, button[aria-label="Gatilho de configurações"]')
    .first()
    .waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1200);
  await dismissAnyCdkBackdrop(page);

  const agentCheckedBtn = page.locator('button.agent-mode-chip-checked').first();
  if (await agentCheckedBtn.isVisible().catch(() => false)) {
    log('[Modo Agente] Desativando agent-mode-chip-checked...');
    await agentCheckedBtn.click();
    await page.waitForTimeout(900);
  }
  await dismissAnyCdkBackdrop(page);

  const warnBtn = page.locator('button[aria-label="Alerta de créditos insuficientes"]').first();
  if (await warnBtn.isVisible().catch(() => false)) {
    throw new Error('CREDITOS_INSUFICIENTES: A conta atual atingiu o limite de creditos do Google Flow.');
  }
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

async function ensureImageMode16x9(page: Page): Promise<void> {
  await ensureInsideFlowProject(page);

  const todasMidias = page.locator(':text("Todas as mídias"), button:has-text("Imagens")').first();
  if (await todasMidias.isVisible().catch(() => false)) {
    await todasMidias.click().catch(() => undefined);
    await page.waitForTimeout(400);
  }

  const triggerBtn = page.locator('button[aria-label="Gatilho de configurações"]').first();
  await triggerBtn.waitFor({ state: 'visible', timeout: 15000 });
  const triggerText = (await triggerBtn.innerText().catch(() => '')).replace(/\s+/g, ' ');
  if (triggerText.includes('Nano Banana') && triggerText.includes('x1')) {
    return;
  }

  await triggerBtn.click();
  await page.waitForTimeout(800);
  await page.locator('button[role="radio"]:has-text("Imagem")').first().click().catch(() => undefined);
  await page.waitForTimeout(500);
  await page.locator('button[role="radio"]:has-text("16:9")').first().click().catch(() => undefined);
  await page.waitForTimeout(400);
  await page.locator('button[role="radio"]:has-text("x1")').first().click().catch(() => undefined);
  await page.waitForTimeout(400);
  await dismissAnyCdkBackdrop(page);
}

async function getGridMediaImageSrcs(page: Page): Promise<string[]> {
  return page
    .locator('img')
    .evaluateAll((els) =>
      els
        .map((e) => e.getAttribute('src') || '')
        .filter(
          (src) =>
            src.startsWith('http') &&
            !src.includes('gstatic.com') &&
            !src.includes('/ogw/') &&
            !src.includes('googleusercontent.com/a/')
        )
    )
    .catch(() => []);
}

async function generateAll20StartFramesAnd3Thumbnails(page: Page): Promise<void> {
  const missingSf = START_FRAME_PROMPTS.filter(
    (s) => !fs.existsSync(path.join(SF_KRAKATOA_DIR, s.file)) || fs.statSync(path.join(SF_KRAKATOA_DIR, s.file)).size < 15_000
  );
  const missingThumbs = THUMBNAIL_PROMPTS.filter(
    (t) => !fs.existsSync(path.join(THUMBS_DIR, t.file)) || fs.statSync(path.join(THUMBS_DIR, t.file)).size < 15_000
  );

  if (missingSf.length === 0 && missingThumbs.length === 0) {
    log('[Start Frames & Thumbs] Todos os 20 Start Frames e 3 Thumbnails ja estao no disco.');
    return;
  }

  await ensureImageMode16x9(page);

  const allTasks: Array<{
    label: string;
    prompt: string;
    dstPath: string;
    width: number;
    height: number;
    copyToArtifact?: string;
  }> = [
    ...missingSf.map((s) => ({
      label: `StartFrame ${s.file}`,
      prompt: `${CHARACTER_START_FRAME_PREFIX} ${s.sceneDesc}`,
      dstPath: path.join(SF_KRAKATOA_DIR, s.file),
      width: 1280,
      height: 720,
    })),
    ...missingThumbs.map((t) => ({
      label: `Thumbnail ${t.file}`,
      prompt: t.prompt,
      dstPath: path.join(THUMBS_DIR, t.file),
      width: 1920,
      height: 1080,
      copyToArtifact: path.join(ARTIFACT_DIR, t.artifactName),
    })),
  ];

  const seenSrcs = new Set<string>(await getGridMediaImageSrcs(page));

  for (let idx = 0; idx < allTasks.length; idx++) {
    const item = allTasks[idx]!;
    log(`[Nano Banana 2.1 (${idx + 1}/${allTasks.length})] Gerando ${item.label}...`);
    await ensureImageMode16x9(page);
    await scrollGridToTop(page);

    const promptBox = page.locator('[role="textbox"][aria-label="O que você quer criar?"]').first();
    await promptBox.click();
    await promptBox.fill(item.prompt);
    await page.waitForTimeout(600);

    const submitBtn = page.locator('button[aria-label="Iniciar geração"]:not([disabled])').first();
    await submitBtn.waitFor({ state: 'visible', timeout: 12000 });
    await submitBtn.click();

    let foundSrc = '';
    for (let poll = 0; poll < 40; poll++) {
      await page.waitForTimeout(2000);
      await scrollGridToTop(page);
      const srcs = await getGridMediaImageSrcs(page);
      const newOne = srcs.find((s) => !seenSrcs.has(s));
      if (newOne) {
        foundSrc = newOne;
        seenSrcs.add(newOne);
        break;
      }
    }

    if (!foundSrc) {
      throw new Error(`Timeout aguardando imagem Nano Banana 2.1 para ${item.label}`);
    }

    const resp = await page.request.get(foundSrc);
    const buf = await resp.body();
    convertAndResizeJpg(buf, item.dstPath, item.width, item.height);
    if (item.copyToArtifact) {
      fs.copyFileSync(item.dstPath, item.copyToArtifact);
    }
    log(
      `[Salvo ${item.label}]: ${item.dstPath} (${(fs.statSync(item.dstPath).size / 1024).toFixed(1)} KB)`
    );
  }
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
  await ensureInsideFlowProject(page);

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

  const sfAbsPath = path.join(SF_KRAKATOA_DIR, startFrameFile);
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

function normalizeTakeTimebase(mp4Path: string): void {
  const tmpPath = `${mp4Path}.norm.mp4`;
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      mp4Path,
      '-vf',
      'scale=1280:720:flags=lanczos,fps=24',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '18',
      '-video_track_timescale',
      '12288',
      '-af',
      'aresample=48000:async=1:first_pts=0',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      tmpPath,
    ],
    { stdio: 'ignore', windowsHide: true }
  );
  fs.renameSync(tmpPath, mp4Path);
}

function getDownloadedTakeCount(): number {
  let count = 0;
  for (let t = 1; t <= TOTAL_TAKES; t++) {
    const p = path.join(KRAKATOA_TAKES_DIR, `take_${String(t).padStart(2, '0')}.mp4`);
    if (fs.existsSync(p) && fs.statSync(p).size > 500_000) {
      count++;
    }
  }
  return count;
}

function assembleMasterEpisode(): void {
  const allTakePaths: string[] = [];
  for (let t = 1; t <= TOTAL_TAKES; t++) {
    const p = path.join(KRAKATOA_TAKES_DIR, `take_${String(t).padStart(2, '0')}.mp4`);
    if (fs.existsSync(p) && fs.statSync(p).size > 500_000) {
      allTakePaths.push(p);
    }
  }
  if (allTakePaths.length === 0) return;

  const concatListPath = path.join(KRAKATOA_TAKES_DIR, 'concat_62_takes.txt');
  writeVerifiedConcatList(allTakePaths, concatListPath);

  const masterEpPath = path.join(EPISODIOS_DIR, 'EP02_KRAKATOA_1883_COMPLETO_PTBR_MASTER.mp4');
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
    `[MASTER ATUALIZADO (${allTakePaths.length}/${TOTAL_TAKES} takes | ~${Math.round(allTakePaths.length * 7.96)}s)]: ${masterEpPath}`
  );
}

async function downloadSingleThumbnail(
  page: Page,
  browserSession: CDPSession,
  thumbIdx: number,
  takeNum: number
): Promise<void> {
  const padTake = String(takeNum).padStart(2, '0');
  const dstPath = path.join(KRAKATOA_TAKES_DIR, `take_${padTake}.mp4`);

  const dlBtn = page
    .locator('button[aria-label="Baixar mídia"], button[aria-label="Fazer o download"]')
    .first();
  const backBtn = page
    .locator('button[aria-label="Edição da cena concluída"], button:has-text("Concluir")')
    .first();

  log(`[Baixando Take ${padTake}/${TOTAL_TAKES} <- miniatura nth(${thumbIdx})...]`);

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
  const rawDownloadedPath = path.join(KRAKATOA_TAKES_DIR, downloadedName);
  if (fs.existsSync(rawDownloadedPath)) {
    assertUniqueDownloadedTake({
      candidatePath: rawDownloadedPath,
      targetTakeNumber: takeNum,
      takesDir: KRAKATOA_TAKES_DIR,
    });
    if (fs.existsSync(dstPath)) fs.unlinkSync(dstPath);
    fs.renameSync(rawDownloadedPath, dstPath);
    normalizeTakeTimebase(dstPath);
  }
  log(
    `[Take ${padTake}/${TOTAL_TAKES} Salvo + Normalizado]: ${dstPath} (${(fs.statSync(dstPath).size / 1024 / 1024).toFixed(2)} MB)`
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
  batch: KrakatoaTakeSpec[]
): Promise<void> {
  const pendingTakes = batch.filter((b) => {
    const p = path.join(KRAKATOA_TAKES_DIR, `take_${String(b.take).padStart(2, '0')}.mp4`);
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
    `=== Submetendo lote de ${pendingTakes.length} takes (Takes ${pendingTakes.map((t) => t.take).join(', ')}) | Total no disco: ${getDownloadedTakeCount()}/${TOTAL_TAKES} ===`
  );

  const submittedTakes: KrakatoaTakeSpec[] = [];

  for (const item of pendingTakes) {
    const padTake = String(item.take).padStart(2, '0');
    const built = buildFlowMotionPromptFromStartFrame({
      rawMotionPrompt: item.motion,
      ptBrDialogue: item.dialogue,
    });

    log(`[Submetendo Take ${padTake}/${TOTAL_TAKES} | Cena ${item.scene} | ${item.startFrame}]`);
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
    if (!takeObj) continue;
    await downloadSingleThumbnail(page, browserSession, thumbIdx, takeObj.take);
  }

  assembleMasterEpisode();
}

export async function main() {
  fs.mkdirSync(SF_KRAKATOA_DIR, { recursive: true });
  fs.mkdirSync(KRAKATOA_TAKES_DIR, { recursive: true });
  fs.mkdirSync(EPISODIOS_DIR, { recursive: true });
  fs.mkdirSync(SHORTS_DIR, { recursive: true });
  fs.mkdirSync(THUMBS_DIR, { recursive: true });
  fs.writeFileSync(
    LOG_PATH,
    `=== INICIANDO RUNNER KRAKATOA 1883 (${getDownloadedTakeCount()}/${TOTAL_TAKES} no disco) ===\n`,
    'utf8'
  );

  try {
    fs.unlinkSync(path.resolve('D:/CANAL 9/flowveo/scripts/probe-flow-image-mode.ts'));
  } catch {}

  const specs: KrakatoaTakeSpec[] = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));

  const browser = await connectOrLaunchFlowBrowser();
  const allPages = browser.contexts().flatMap((c) => c.pages());
  const page =
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
    downloadPath: KRAKATOA_TAKES_DIR,
    eventsEnabled: true,
  });

  await ensureInsideFlowProject(page, getDownloadedTakeCount() >= 35);

  // Etapa 1: Gerar os 20 Start Frames + 3 Thumbnails no Nano Banana 2.1 do Flow
  await generateAll20StartFramesAnd3Thumbnails(page);

  // Etapa 2: Gerar e baixar os 62 Takes de Video no Veo 3.1 do Flow
  const BATCH_SIZE = 4;
  for (let pass = 1; pass <= 4; pass++) {
    if (getDownloadedTakeCount() >= specs.length) break;
    log(`================ PASSAGEM ${pass}/4 (Baixados: ${getDownloadedTakeCount()}/${TOTAL_TAKES}) ================`);
    for (let i = 0; i < specs.length; i += BATCH_SIZE) {
      const batch = specs.slice(i, i + BATCH_SIZE);
      await submitAndDownloadBatch(page, browserSession, batch);
    }
  }

  assembleMasterEpisode();

  const shortResult = await buildSingleFullStoryShort({
    episodeSlug: 'KRAKATOA_1883',
    takesDir: KRAKATOA_TAKES_DIR,
    shortsOutDir: SHORTS_DIR,
    strategicTakeNumbers: [1, 10, 22, 29, 36, 45, 62],
    topBadgeText: '27 DE AGOSTO DE 1883 • 10:02 AM',
    titleLine1: 'VIAJEI PARA KRAKATOA',
    titleLine2: 'A MAIOR EXPLOSÃO DA TERRA',
    subtitleLine: 'O Som de 310 Decibéis e o Tsunami de 40 Metros',
    youtubeMetadata: {
      title:
        'Viajei para KRAKATOA em 1883: O Som de 310 Decibéis e o Tsunami de 40 Metros #shorts',
      description:
        '27 de agosto de 1883, 10h02 da manhã. A história completa da erupção de Krakatoa do início ao fim: do dia que virou noite e o som mais alto da história humana (310 dB) até o mega-tsunami de 40 metros. Assista ao episódio completo de 8 minutos no canal! #krakatoa #viagemnotempo #historia #shorts',
      tags: [
        'krakatoa',
        'krakatoa 1883',
        'erupcao krakatoa',
        'som mais alto da historia',
        '310 decibeis',
        'viagem no tempo',
        'tsunami krakatoa',
        'historia',
        'shorts',
      ],
    },
    purgeLegacyFragmentedShorts: false,
  });
  log(
    `[SHORT UNICO HISTORIA COMPLETA SALVO]: ${shortResult.shortVideoPath} (${shortResult.durationSec}s | ${shortResult.sizeMB} MB)`
  );

  log(`=== CONCLUIDO KRAKATOA 1883: ${getDownloadedTakeCount()}/${TOTAL_TAKES} takes ===`);
  process.exit(0);
}

main().catch((err) => {
  log(`ERRO NO RUNNER DE KRAKATOA: ${err?.stack || err}`);
  process.exit(1);
});
