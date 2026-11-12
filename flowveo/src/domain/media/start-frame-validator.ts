import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigValidationError, PolicyDeniedError } from '../../shared/errors.js';

export interface ValidatedStartFrame {
  absolutePath: string;
  filename: string;
  format: 'png' | 'jpeg';
  width: number;
  height: number;
  aspectRatio: '16:9' | '9:16';
  sizeBytes: number;
  sha256: string;
}

/**
 * Extrai dimensoes reais (width x height) diretamente do cabecalho binario IHDR (PNG) ou SOF (JPEG).
 */
export function inspectImageHeader(buf: Buffer): {
  format: 'png' | 'jpeg';
  width: number;
  height: number;
} {
  // 1. Verificar assinatura PNG: 89 50 4E 47 0D 0A 1A 0A + chunk IHDR
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width <= 0 || height <= 0) {
      throw new ConfigValidationError('Cabecalho PNG IHDR com dimensoes invalidas.');
    }
    return { format: 'png', width, height };
  }

  // 2. Verificar assinatura JPEG: FF D8 FF e varrer marcadores SOF0..SOF2 (C0, C1, C2)
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buf[offset + 1]!;
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const segLen = buf.readUInt16BE(offset + 2);
      if (segLen < 2 || offset + 2 + segLen > buf.length) {
        break;
      }
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        if (width > 0 && height > 0) {
          return { format: 'jpeg', width, height };
        }
      }
      offset += 2 + segLen;
    }
    throw new ConfigValidationError('Arquivo JPEG truncado ou sem marcador SOF de resolucao.');
  }

  throw new ConfigValidationError(
    'Assinatura binaria (magic bytes) invalida: Start Frame deve ser PNG ou JPEG real.'
  );
}

/**
 * StartFrameValidator (Subetapa SF-1 — Paridade com Firefly & Fail-Closed):
 * - Bloqueia Path Traversal e symlinks fora do baseDir autorizado.
 * - Valida magic bytes PNG/JPEG e resolucao 16:9 (ex: 1920x1080, 1280x720) ou 9:16 (ex: 1080x1920, 720x1280).
 * - Garante politica Zero-Reuso por SHA-256 unico quando flowDb e informado.
 */
export class StartFrameValidator {
  private readonly allowedBaseDir: string;
  private readonly isSha256AlreadyUsed?: (sha256: string) => boolean;

  constructor(params: {
    allowedBaseDir: string;
    isSha256AlreadyUsed?: (sha256: string) => boolean;
  }) {
    this.allowedBaseDir = path.resolve(params.allowedBaseDir);
    this.isSha256AlreadyUsed = params.isSha256AlreadyUsed;
  }

  public validateStartFrame(params: {
    relativeOrFilePath: string;
    expectedAspectRatio: '16:9' | '9:16';
    enforceUniqueSha256?: boolean;
  }): ValidatedStartFrame {
    const rawPath = params.relativeOrFilePath;
    if (
      !rawPath ||
      rawPath.includes('\0') ||
      rawPath.includes('..') ||
      path.isAbsolute(rawPath)
    ) {
      throw new PolicyDeniedError(
        `Tentativa de Path Traversal ou caminho absoluto rejeitada no Start Frame: '${rawPath}'`
      );
    }

    const candidatePath = path.resolve(this.allowedBaseDir, rawPath);
    const rel = path.relative(this.allowedBaseDir, candidatePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new PolicyDeniedError(
        `Start Frame escapa do diretorio base autorizado: '${rawPath}'`
      );
    }

    if (!fs.existsSync(candidatePath)) {
      throw new ConfigValidationError(`Start Frame nao encontrado em disco: '${candidatePath}'`);
    }

    const lstat = fs.lstatSync(candidatePath);
    if (lstat.isSymbolicLink() || !lstat.isFile()) {
      throw new PolicyDeniedError('Start Frame nao pode ser symlink nem diretorio.');
    }

    if (lstat.size < 64) {
      throw new ConfigValidationError(
        `Start Frame corrompido ou vazio (${lstat.size} bytes).`
      );
    }

    const buf = fs.readFileSync(candidatePath);
    const { format, width, height } = inspectImageHeader(buf);

    // Verificar proporcao 16:9 ou 9:16 (tolerancia estrita de proporcao)
    const ratio = width / height;
    const is16x9 = Math.abs(ratio - 16 / 9) < 0.02;
    const is9x16 = Math.abs(ratio - 9 / 16) < 0.02;

    if (!is16x9 && !is9x16) {
      throw new ConfigValidationError(
        `Proporcao invalida no Start Frame (${width}x${height}). Exigido 16:9 ou 9:16.`
      );
    }

    const detectedAspect: '16:9' | '9:16' = is16x9 ? '16:9' : '9:16';
    if (detectedAspect !== params.expectedAspectRatio) {
      throw new ConfigValidationError(
        `Start Frame tem proporcao ${detectedAspect} (${width}x${height}), mas o Job exige ${params.expectedAspectRatio}.`
      );
    }

    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

    if (params.enforceUniqueSha256 && this.isSha256AlreadyUsed) {
      if (this.isSha256AlreadyUsed(sha256)) {
        throw new PolicyDeniedError(
          `Violacao Zero-Reuso: Start Frame com SHA-256 '${sha256.slice(0, 16)}...' ja foi utilizado anteriormente.`
        );
      }
    }

    return {
      absolutePath: candidatePath,
      filename: path.basename(candidatePath),
      format,
      width,
      height,
      aspectRatio: detectedAspect,
      sizeBytes: lstat.size,
      sha256,
    };
  }
}
