import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigValidationError } from '../../shared/errors.js';
import { writeVerifiedConcatList } from './take-deduplicator.js';

export interface SingleShortBuildParams {
  episodeSlug: string;
  takesDir: string;
  shortsOutDir: string;
  /**
   * 7 takes estratégicos em ordem estritamente crescente (Início -> Meio -> Clímax -> Fim)
   */
  strategicTakeNumbers: ReadonlyArray<number>;
  /**
   * Badge superior (ex.: "26 DE ABRIL DE 1986 • 01:23 AM")
   */
  topBadgeText: string;
  /**
   * Linha 1 do Título no Topo (Branco Extra-Bold)
   */
  titleLine1: string;
  /**
   * Linha 2 do Título no Topo (Amarelo Ouro Extra-Bold)
   */
  titleLine2: string;
  /**
   * Subtítulo explicativo abaixo do título principal
   */
  subtitleLine: string;
  /**
   * Metadados de publicação (YouTube Title, Description, Tags)
   */
  youtubeMetadata: {
    title: string;
    description: string;
    tags: string[];
  };
  purgeLegacyFragmentedShorts?: boolean;
}

export function renderShortHeaderOverlayPng(params: {
  outPngPath: string;
  topBadgeText: string;
  titleLine1: string;
  titleLine2: string;
  subtitleLine: string;
}): void {
  const pyScript = `
import sys, json
from PIL import Image, ImageDraw, ImageFont

cfg = json.loads(sys.argv[1])
W, H = 1080, 1920
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Gradiente superior (Y: 0..555)
for y in range(555):
    alpha = int(242 * (1.0 - (y / 555.0) ** 1.6))
    draw.line([(0, y), (W, y)], fill=(6, 9, 15, alpha))

# Gradiente inferior (Y: 1173..1920)
for y in range(1173, H):
    t = (y - 1173) / float(H - 1173)
    alpha = int(225 * (t ** 1.2))
    draw.line([(0, y), (W, y)], fill=(6, 9, 15, alpha))

def load_font(paths, size):
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()

font_badge = load_font(["C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/segoeui.ttf"], 27)
font_title1 = load_font(["C:/Windows/Fonts/ariblk.ttf", "C:/Windows/Fonts/impact.ttf", "C:/Windows/Fonts/arialbd.ttf"], 54)
font_title2 = load_font(["C:/Windows/Fonts/ariblk.ttf", "C:/Windows/Fonts/impact.ttf", "C:/Windows/Fonts/arialbd.ttf"], 56)
font_sub = load_font(["C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/segoeui.ttf"], 31)
font_footer = load_font(["C:/Windows/Fonts/arialbd.ttf"], 25)

def draw_centered_text(y, text, font, fill, shadow_offset=4):
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    x = (W - tw) // 2
    if shadow_offset > 0:
        draw.text((x + shadow_offset, y + shadow_offset), text, font=font, fill=(0, 0, 0, 235))
        draw.text((x - 2, y + 2), text, font=font, fill=(0, 0, 0, 190))
    draw.text((x, y), text, font=font, fill=fill)

# Pill vermelha superior
draw.rounded_rectangle([190, 145, 890, 203], radius=29, fill=(185, 28, 28, 245), outline=(252, 165, 165, 255), width=2)
draw_centered_text(157, cfg["topBadgeText"].upper(), font_badge, (255, 255, 255, 255), shadow_offset=2)

# Titulo Linha 1 (Branco) e Linha 2 (Amarelo Ouro)
draw_centered_text(230, cfg["titleLine1"].upper(), font_title1, (255, 255, 255, 255), shadow_offset=4)
draw_centered_text(310, cfg["titleLine2"].upper(), font_title2, (250, 204, 21, 255), shadow_offset=4)

# Subtitulo
draw_centered_text(405, cfg["subtitleLine"], font_sub, (226, 232, 240, 255), shadow_offset=3)

# Linhas douradas emoldurando a janela 16:9 completa (Y=560..1168)
draw.rectangle([0, 555, W, 560], fill=(250, 204, 21, 255))
draw.rectangle([0, 1168, W, 1173], fill=(250, 204, 21, 255))

# Pill inferior indicando historia completa
draw.rounded_rectangle([235, 1210, 845, 1264], radius=27, fill=(15, 23, 42, 230), outline=(56, 189, 248, 255), width=2)
draw_centered_text(1222, "HISTÓRIA COMPLETA • INÍCIO AO FIM", font_footer, (56, 189, 248, 255), shadow_offset=2)

img.save(cfg["outPngPath"], "PNG")
`;

  execFileSync('python', ['-c', pyScript, JSON.stringify(params)], {
    stdio: 'inherit',
    windowsHide: true,
  });
}

export async function buildSingleFullStoryShort(
  params: SingleShortBuildParams
): Promise<{
  shortVideoPath: string;
  metadataJsonPath: string;
  durationSec: number;
  sizeMB: number;
  takesUsed: number[];
}> {
  if (params.strategicTakeNumbers.length < 5 || params.strategicTakeNumbers.length > 8) {
    throw new ConfigValidationError(
      `O Short Unico deve conter entre 5 e 8 cortes estrategicos para contar a historia completa (recebido: ${params.strategicTakeNumbers.length}).`
    );
  }

  for (let i = 1; i < params.strategicTakeNumbers.length; i++) {
    const prev = params.strategicTakeNumbers[i - 1]!;
    const curr = params.strategicTakeNumbers[i]!;
    if (curr <= prev) {
      throw new ConfigValidationError(
        `Os cortes do Short devem seguir ordem cronologica estritamente crescente (Início -> Fim). Violacao: Take ${prev} seguido de Take ${curr}.`
      );
    }
  }

  fs.mkdirSync(params.shortsOutDir, { recursive: true });

  if (params.purgeLegacyFragmentedShorts) {
    for (const f of fs.readdirSync(params.shortsOutDir)) {
      if (/^SHORT_0[123]_/i.test(f) && f.endsWith('.mp4')) {
        try {
          fs.unlinkSync(path.join(params.shortsOutDir, f));
        } catch {}
      }
    }
  }

  const takePaths = params.strategicTakeNumbers.map((t) =>
    path.join(params.takesDir, `take_${String(t).padStart(2, '0')}.mp4`)
  );

  const concatListPath = path.join(
    params.takesDir,
    `concat_short_master_${params.episodeSlug}.txt`
  );
  writeVerifiedConcatList(takePaths, concatListPath);

  const overlayPngPath = path.join(
    params.takesDir,
    `overlay_short_master_${params.episodeSlug}.png`
  );
  renderShortHeaderOverlayPng({
    outPngPath: overlayPngPath,
    topBadgeText: params.topBadgeText,
    titleLine1: params.titleLine1,
    titleLine2: params.titleLine2,
    subtitleLine: params.subtitleLine,
  });

  const shortVideoPath = path.join(
    params.shortsOutDir,
    `SHORT_MASTER_${params.episodeSlug}_HISTORIA_COMPLETA.mp4`
  );

  // Canvas 1080x1920 mantendo 100% da largura horizontal 16:9 (1080x608 em Y=560)
  // sobre fundo vertical ambient blur + Banner de Título fixo no topo
  const filterComplex = [
    '[0:v]split=2[bg][fg]',
    '[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:6,eq=brightness=-0.28:saturation=1.15[bgblur]',
    '[fg]scale=1080:608:flags=lanczos[fgfull]',
    '[bgblur][fgfull]overlay=0:560[canvas]',
    '[canvas][1:v]overlay=0:0:format=auto[vout]',
  ].join(';');

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
      '-i',
      overlayPngPath,
      '-filter_complex',
      filterComplex,
      '-map',
      '[vout]',
      '-map',
      '0:a',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-af',
      'aresample=async=1:first_pts=0',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      shortVideoPath,
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  const probeJson = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,size:stream=width,height,codec_name',
      '-of',
      'json',
      shortVideoPath,
    ],
    { encoding: 'utf8', windowsHide: true }
  );
  const probe = JSON.parse(probeJson) as {
    format?: { duration?: string; size?: string };
  };
  const durationSec = Number(Number(probe.format?.duration ?? 0).toFixed(2));
  const sizeMB = Number((Number(probe.format?.size ?? 0) / 1024 / 1024).toFixed(2));

  const metadataJsonPath = path.join(
    params.shortsOutDir,
    `SHORT_MASTER_${params.episodeSlug}_METADATA.json`
  );
  fs.writeFileSync(
    metadataJsonPath,
    JSON.stringify(
      {
        episodeSlug: params.episodeSlug,
        shortVideoPath,
        durationSec,
        sizeMB,
        resolution: '1080x1920',
        framingMode: 'FULL_WIDTH_16_9_IN_9_16_CANVAS_ZERO_SCENE_CLIPPING',
        strategicTakes: params.strategicTakeNumbers,
        headerBanner: {
          topBadgeText: params.topBadgeText,
          titleLine1: params.titleLine1,
          titleLine2: params.titleLine2,
          subtitleLine: params.subtitleLine,
        },
        youtubeMetadata: params.youtubeMetadata,
      },
      null,
      2
    ),
    'utf8'
  );

  return {
    shortVideoPath,
    metadataJsonPath,
    durationSec,
    sizeMB,
    takesUsed: [...params.strategicTakeNumbers],
  };
}
