import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const REAL_TAKES_DIR = path.resolve('D:/CANAL 9/flowveo/runtime/artifacts/real_flow_takes');
const EPISODIOS_DIR = path.resolve('D:/CANAL 9/storage_local/episodios');

async function main() {
  fs.mkdirSync(REAL_TAKES_DIR, { recursive: true });
  fs.mkdirSync(EPISODIOS_DIR, { recursive: true });

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 30000 });
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('No page');

  await page.bringToFront();

  const browserSession = await browser.newBrowserCDPSession();
  await browserSession.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: REAL_TAKES_DIR,
    eventsEnabled: true,
  });

  // Se estiver no modal de detalhes, clicar em "Concluir" para voltar ao grid
  const concluirBtn = page.locator('button[aria-label="Edição da cena concluída"], button:has-text("Concluir")').first();
  if (await concluirBtn.isVisible().catch(() => false)) {
    await concluirBtn.evaluate((el: HTMLElement) => el.click());
    await page.waitForTimeout(2000);
  }

  // Ja baixamos nth(0), nth(1), nth(2), nth(3) (Takes 8, 7, 6, 5). Agora baixamos nth(4) até nth(7) (Takes 4, 3, 2, 1)!
  for (let idx = 4; idx <= 7; idx++) {
    console.log(`\n--- Abrindo miniatura nth(${idx}) via DOM click... ---`);
    const thumb = page.locator('img[alt="Miniatura do vídeo gerada"]').nth(idx);
    await thumb.evaluate((el: HTMLElement) => {
      el.scrollIntoView({ block: 'center' });
      el.click();
    });
    await page.waitForTimeout(2500);

    const downloadDone = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout no download nth(${idx})`)), 45000);
      let suggested = '';
      const onBegin = (ev: { suggestedFilename: string }) => {
        suggested = ev.suggestedFilename;
        console.log('Iniciando download:', suggested);
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

    const dlBtn = page.locator('button[aria-label="Baixar mídia"], button[aria-label="Fazer o download"]').first();
    await dlBtn.waitFor({ state: 'visible', timeout: 10000 });
    await dlBtn.evaluate((el: HTMLElement) => el.click());
    await page.waitForTimeout(1000);

    const item720 = page.locator('[role="menuitem"]:has-text("720p")').first();
    await item720.waitFor({ state: 'visible', timeout: 10000 });
    await item720.evaluate((el: HTMLElement) => el.click());

    const filename = await downloadDone;
    console.log(`Download concluído nth(${idx}): ${filename}`);
    await page.waitForTimeout(1000);

    const backBtn = page.locator('button[aria-label="Edição da cena concluída"], button:has-text("Concluir")').first();
    if (await backBtn.isVisible().catch(() => false)) {
      await backBtn.evaluate((el: HTMLElement) => el.click());
      await page.waitForTimeout(2000);
    }
  }

  // Mapear explicitamente cada um dos 8 arquivos baixados pela ordem exata dos Takes 1 a 8:
  const takePrefixes = [
    { take: 1, match: 'Backpacker_walking_along_Roman' },
    { take: 2, match: 'Backpacker_recording_video_near' },
    { take: 3, match: 'Backpacker_records_volcanic_erup' },
    { take: 4, match: 'Backpacker_jogs_through_volcanic' },
    { take: 5, match: 'Backpacker_running_from_volcanic' },
    { take: 6, match: 'Backpacker_records_selfie_vlog' },
    { take: 7, match: 'Backpacker_speaking_Portuguese' },
    { take: 8, match: 'Backpacker_walking_on_ship_deck' },
  ];

  const rawFiles = fs
    .readdirSync(REAL_TAKES_DIR)
    .filter((f) => f.endsWith('.mp4') && !f.startsWith('take_'));

  console.log('\n=== ARQUIVOS MP4 REAIS DO GOOGLE FLOW (ORDEM TAKE 1 -> TAKE 8) ===');
  const orderedPaths: string[] = [];
  for (const spec of takePrefixes) {
    const found = rawFiles.find((f) => f.includes(spec.match));
    if (!found) {
      throw new Error(`Arquivo MP4 não encontrado para Take ${spec.take} (${spec.match})`);
    }
    const srcPath = path.join(REAL_TAKES_DIR, found);
    const dstName = `take_0${spec.take}_flow_real.mp4`;
    const dstPath = path.join(REAL_TAKES_DIR, dstName);
    fs.copyFileSync(srcPath, dstPath);
    const sizeMB = (fs.statSync(dstPath).size / 1024 / 1024).toFixed(2);
    console.log(`Take 0${spec.take}: ${dstName} <- ${found} (${sizeMB} MB)`);
    orderedPaths.push(dstPath);
  }

  const concatListPath = path.join(REAL_TAKES_DIR, 'concat_list.txt');
  const concatContent = orderedPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n');
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

  const probeJson = execFileSync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', masterOutPath],
    { encoding: 'utf8', windowsHide: true }
  );
  const probe = JSON.parse(probeJson);
  console.log(
    '\n=== MASTER 60S VERIFICADO COM FFPROBE ===\n',
    JSON.stringify(
      {
        masterOutPath,
        sizeMB: (Number(probe.format.size) / 1024 / 1024).toFixed(2),
        durationSec: Number(probe.format.duration).toFixed(2),
        streams: probe.streams.map((s: Record<string, unknown>) => ({
          codec_type: s.codec_type,
          codec_name: s.codec_name,
          width: s.width,
          height: s.height,
          sample_rate: s.sample_rate,
        })),
      },
      null,
      2
    )
  );

  process.exit(0);
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
