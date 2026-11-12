import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { buildFlowMotionPromptFromStartFrame } from '../src/domain/media/flow-motion-prompt.js';

const PROJECT_ROOT = path.resolve('D:/CANAL 9/flowveo');
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'runtime');
const START_FRAMES_DIR = path.join(RUNTIME_DIR, 'start_frames_60s');
const REAL_TAKES_DIR = path.join(RUNTIME_DIR, 'artifacts', 'real_flow_takes');
const EPISODIOS_DIR = path.resolve('D:/CANAL 9/storage_local/episodios');

interface TakeSpec {
  index: number;
  id: string;
  startFrameFile: string;
  rawMotionPrompt: string;
  ptBrDialogue: string;
}

const TAKES_60S: TakeSpec[] = [
  {
    index: 1,
    id: 'take_01_aqueduto_romano',
    startFrameFile: 'sf_01_take_01_aqueduto_romano.jpg',
    rawMotionPrompt:
      'Raw handheld iPhone 0.5x ultra-wide trekking video starting from the first frame: the 25-year-old backpacker in dark navy cap, burnt-terracotta Gore-Tex jacket and charcoal backpack walks along the dusty Roman trail beside the monumental stone aqueduct arches, turns his head toward the camera lens and speaks naturally in Brazilian Portuguese with realistic lip-sync',
    ptBrDialogue:
      'Vocês não vão acreditar onde eu acabei de cair. Aquele aqueduto romano ali atrás ainda está inteiro e funcionando.',
  },
  {
    index: 2,
    id: 'take_02_guarda_coliseu',
    startFrameFile: 'sf_02_take_02_guarda_coliseu.jpg',
    rawMotionPrompt:
      'Raw handheld iPhone 0.5x selfie vlog video starting from the first frame: the 25-year-old backpacker in dark navy cap and burnt-terracotta jacket holds the camera at arm length outside the Roman Colosseum while a suspicious Roman legionary guard in iron lorica segmentata armor glares at the lens behind him, speaking in Brazilian Portuguese with natural lip-sync',
    ptBrDialogue:
      'Mano, fala baixo... esse guarda romano aqui atrás não para de encarar a lente do meu celular.',
  },
  {
    index: 3,
    id: 'take_03_pompeia_chegada',
    startFrameFile: 'sf_03_take_03_pompeia_chegada.jpg',
    rawMotionPrompt:
      'Raw handheld iPhone 0.5x ultra-wide selfie vlog video starting from the first frame: the 25-year-old backpacker in dark navy cap, burnt-terracotta jacket and yellow backpack rain cover walks down the stone street of Pompeii in 79 AD as Mount Vesuvius erupts with a massive black ash plume in the background, speaking in Brazilian Portuguese with natural lip-sync',
    ptBrDialogue:
      'Olha o tamanho daquela nuvem preta subindo do Vesúvio. O chão de pedra inteirinho está tremendo aqui em Pompeia.',
  },
  {
    index: 4,
    id: 'take_04_pompeia_mercado_cinzas',
    startFrameFile: 'sf_04_take_04_pompeia_mercado_cinzas.jpg',
    rawMotionPrompt:
      'Raw handheld iPhone 0.5x ultra-wide selfie vlog video starting from the first frame: the 25-year-old backpacker in dark navy cap and burnt-terracotta jacket jogs through the narrow Pompeii market alley under heavy falling grey volcanic ash and pumice stones while Roman citizens flee behind him, speaking urgently in Brazilian Portuguese with natural lip-sync',
    ptBrDialogue:
      'Está chovendo pedra-pomes e cinza quente no mercado! Todo mundo está largando as bancas de pão e correndo pro porto!',
  },
  {
    index: 5,
    id: 'take_05_pompeia_forum_fuga',
    startFrameFile: 'sf_05_take_05_pompeia_forum_fuga.jpg',
    rawMotionPrompt:
      'Raw handheld iPhone 0.5x ultra-wide selfie vlog video starting from the first frame: the 25-year-old backpacker in dark navy cap and burnt-terracotta jacket runs across the colonnaded Forum of Pompeii as the sky turns pitch black with glowing orange volcanic lightning overhead, speaking breathlessly in Brazilian Portuguese with natural lip-sync',
    ptBrDialogue:
      'O dia virou noite em dois minutos! Se eu não acionar o salto temporal agora, não vou sair vivo do Fórum!',
  },
  {
    index: 6,
    id: 'take_06_egito_piramides',
    startFrameFile: 'sf_06_take_06_egito_piramides.jpg',
    rawMotionPrompt:
      'Raw handheld iPhone 0.5x ultra-wide selfie vlog video starting from the first frame: the 25-year-old backpacker in dark navy cap and burnt-terracotta jacket wipes sweat and ash under the blazing desert sun at Giza in 2500 BC while thousands of workers haul white limestone blocks up the Great Pyramid behind him, speaking in Brazilian Portuguese with natural lip-sync',
    ptBrDialogue:
      'Deu certo! Saí da cinza direto pro sol de quarenta graus de Gizé. Eles estão subindo os blocos de calcário branco na nossa frente!',
  },
  {
    index: 7,
    id: 'take_07_titanic_porto',
    startFrameFile: 'sf_07_take_07_titanic_porto.jpg',
    rawMotionPrompt:
      'Raw handheld iPhone 0.5x ultra-wide selfie vlog video starting from the first frame: the 25-year-old backpacker in dark navy cap and burnt-terracotta jacket stands on the wet wooden pier at Southampton dock in 1912 beside the towering black hull of the RMS Titanic and Edwardian passengers in wool coats, speaking in Brazilian Portuguese with natural lip-sync',
    ptBrDialogue:
      'Dez de abril de mil novecentos e doze. Olha o tamanho do casco do Titanic aqui no píer de Southampton antes de zarpar.',
  },
  {
    index: 8,
    id: 'take_08_titanic_conves',
    startFrameFile: 'sf_08_take_08_titanic_conves.jpg',
    rawMotionPrompt:
      'Raw handheld iPhone 0.5x ultra-wide selfie vlog video starting from the first frame: the 25-year-old backpacker in dark navy cap and burnt-terracotta jacket walks along the wooden Boat Deck of the RMS Titanic at sea beneath the giant ochre-buff smokestacks and white wooden lifeboats, speaking in Brazilian Portuguese with natural lip-sync',
    ptBrDialogue:
      'Consegui subir no convés dos botes. Ninguém aqui imagina o que espera esse navio no meio do Atlântico Norte.',
  },
];

async function submitSingleTake(page: Page, take: TakeSpec): Promise<void> {
  const sfAbsPath = path.join(START_FRAMES_DIR, take.startFrameFile);
  const built = buildFlowMotionPromptFromStartFrame({
    rawMotionPrompt: take.rawMotionPrompt,
    ptBrDialogue: take.ptBrDialogue,
  });
  const fullPrompt = built.promptText;

  console.log(`\n=== [Submetendo Take ${take.index}/8: ${take.id}] ===`);

  // 1. Abrir slot "Início" se "Enviar mídia" nao estiver visivel
  const uploadBtn = page.locator('button:has-text("Enviar mídia")').first();
  if (!(await uploadBtn.isVisible().catch(() => false))) {
    const inicioBtn = page.locator('button:has-text("Início")').first();
    await inicioBtn.click();
    await page.waitForTimeout(1000);
  }

  // 2. Enviar arquivo via FileChooser
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    uploadBtn.click(),
  ]);
  await fileChooser.setFiles(sfAbsPath);

  // 3. Aguardar o upload concluir e o botao "Incluir no comando" habilitar
  const incluirBtn = page.locator('button:has-text("Incluir no comando"):not([disabled])').first();
  let included = false;
  for (let i = 0; i < 35; i++) {
    await page.waitForTimeout(1000);
    if (await incluirBtn.isVisible().catch(() => false)) {
      await incluirBtn.click();
      included = true;
      break;
    }
    // Se o item enviado ja apareceu na lista mas ainda nao foi clicado, clicar nele
    if (i >= 4) {
      const uploadedItem = page
        .locator(`button:has-text("${take.startFrameFile}")`)
        .filter({ hasNotText: 'Enviando' })
        .last();
      if (await uploadedItem.isVisible().catch(() => false)) {
        await uploadedItem.click().catch(() => undefined);
      }
    }
  }
  if (!included) {
    throw new Error(`Timeout aguardando 'Incluir no comando' para ${take.startFrameFile}`);
  }
  await page.waitForTimeout(1200);

  // 4. Preencher prompt
  const promptBox = page.locator('[role="textbox"][aria-label="O que você quer criar?"]').first();
  await promptBox.click();
  await promptBox.fill(fullPrompt);
  await page.waitForTimeout(1200);

  // 5. Clicar em "Iniciar geração"
  const submitBtn = page.locator('button[aria-label="Iniciar geração"]:not([disabled])').first();
  await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
  await submitBtn.click();
  console.log(`[Take ${take.index}/8] Submetido com sucesso no Google Flow!`);
  await page.waitForTimeout(5000);
}

async function main() {
  fs.mkdirSync(REAL_TAKES_DIR, { recursive: true });
  fs.mkdirSync(EPISODIOS_DIR, { recursive: true });

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 5000 });
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('Nenhuma aba encontrada na porta 9222');

  await page.bringToFront();

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const take1AlreadySubmitted = bodyText.includes('Aquele aqueduto romano ali atrás');

  for (const take of TAKES_60S) {
    if (take.index === 1 && take1AlreadySubmitted) {
      console.log('[Take 1/8] Ja submetido anteriormente no Google Flow — pulando reenvio.');
      continue;
    }
    await submitSingleTake(page, take);
  }

  console.log(
    '\n=== Todos os 8 takes foram submetidos no Google Flow! Aguardando renderizacao dos 8 videos... ==='
  );

  // Clicar na aba "Vídeos" na barra lateral para filtrar apenas os videos gerados
  const videosTab = page.locator('button:has-text("Vídeos")').first();
  if (await videosTab.isVisible().catch(() => false)) {
    await videosTab.click();
    await page.waitForTimeout(2000);
  }

  // Aguardar ate 8 elementos <video> com src valido (ate 6 minutos)
  let videoUrls: string[] = [];
  for (let poll = 0; poll < 90; poll++) {
    videoUrls = await page.evaluate(() => {
      const vids = Array.from(document.querySelectorAll('video'));
      return vids
        .map((v) => v.currentSrc || v.getAttribute('src') || '')
        .filter((u) => u.startsWith('http'));
    });
    const uniqueUrls = Array.from(new Set(videoUrls));
    console.log(`[Poll ${poll + 1}/90] Videos prontos no DOM: ${uniqueUrls.length}/8`);
    if (uniqueUrls.length >= 8) {
      videoUrls = uniqueUrls;
      break;
    }
    await page.waitForTimeout(4000);
  }

  // No grid do Flow, os mais recentes ficam no topo (ordem reversa: Take 8 -> Take 1)
  const orderedUrls = [...videoUrls].slice(0, 8).reverse();
  const downloadedPaths: string[] = [];

  for (let i = 0; i < orderedUrls.length; i++) {
    const url = orderedUrls[i];
    const takeNum = i + 1;
    const outPath = path.join(REAL_TAKES_DIR, `take_0${takeNum}_flow_real.mp4`);
    console.log(`Baixando video real ${takeNum}/${orderedUrls.length}: ${url.slice(0, 80)}...`);

    const base64Data = await page.evaluate(async (videoUrl) => {
      const resp = await fetch(videoUrl);
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let j = 0; j < bytes.byteLength; j++) {
        binary += String.fromCharCode(bytes[j]);
      }
      return btoa(binary);
    }, url);

    fs.writeFileSync(outPath, Buffer.from(base64Data, 'base64'));
    downloadedPaths.push(outPath);
    console.log(`Salvo: ${outPath} (${fs.statSync(outPath).size} bytes)`);
  }

  if (downloadedPaths.length > 0) {
    const concatListPath = path.join(REAL_TAKES_DIR, 'concat_list.txt');
    const concatContent = downloadedPaths
      .map((p) => `file '${p.replace(/\\/g, '/')}'`)
      .join('\n');
    fs.writeFileSync(concatListPath, concatContent, 'utf8');

    const masterOutPath = path.join(EPISODIOS_DIR, 'teste_60s_mochileiro_tempo_ptbr_master.mp4');
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
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        masterOutPath,
      ],
      { stdio: 'inherit', windowsHide: true }
    );
    console.log(`\n[SUCESSO] Master de 60s real do Google Flow salvo em: ${masterOutPath}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('ERRO:', err);
  process.exit(1);
});
