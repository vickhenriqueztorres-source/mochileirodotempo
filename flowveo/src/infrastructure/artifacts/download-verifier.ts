import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { promisify } from 'node:util';
import type { ArtifactChainLink, ArtifactRecord } from '../../domain/artifacts/artifact-types.js';
import type { CompletionPolicy } from '../../domain/jobs/job-types.js';
import { ArtifactStore } from './artifact-store.js';

const execFileAsync = promisify(execFile);

export interface FfprobeMetadata {
  containerFormat: string;
  durationSec: number;
  width: number;
  height: number;
}

export type FfprobeRunner = (
  filePath: string,
  options: { shell: false; timeout: number }
) => Promise<FfprobeMetadata>;

export const defaultFfprobeRunner: FfprobeRunner = async (filePath, options) => {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,codec_name:format=format_name,duration',
      '-of',
      'json',
      filePath,
    ],
    {
      shell: false,
      timeout: options.timeout,
      windowsHide: true,
    }
  );

  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number; codec_name?: string }>;
    format?: { format_name?: string; duration?: string };
  };

  const stream = parsed.streams?.[0];
  const format = parsed.format;
  const durationSec = Number(format?.duration ?? 0);
  const width = Number(stream?.width ?? 0);
  const height = Number(stream?.height ?? 0);

  return {
    containerFormat: String(format?.format_name ?? 'mp4'),
    durationSec,
    width,
    height,
  };
};

export function hasValidContainerMagicBytes(
  headerBytes: Buffer,
  expectedContainer: 'mp4' | 'webm'
): boolean {
  if (expectedContainer === 'mp4') {
    if (headerBytes.length < 12) return false;
    // ISO Base Media File Format (MP4/MOV) possui 'ftyp' nos bytes 4..8
    const boxType = headerBytes.subarray(4, 8).toString('ascii');
    return boxType === 'ftyp';
  }
  if (expectedContainer === 'webm') {
    if (headerBytes.length < 4) return false;
    // EBML magic bytes: 0x1A 0x45 0xDF 0xA3
    return (
      headerBytes[0] === 0x1a &&
      headerBytes[1] === 0x45 &&
      headerBytes[2] === 0xdf &&
      headerBytes[3] === 0xa3
    );
  }
  return false;
}

/**
 * DownloadVerifier (Arquitetura §18 / BC-14, S-08):
 * - Verifica existencia, nao-symlink, tamanho minimo, Magic Bytes (ftyp/EBML) e SHA-256.
 * - Opcionalmente executa ffprobe via execFile com shell: false e timeout estrito.
 */
export class DownloadVerifier {
  private readonly artifactStore: ArtifactStore;
  private readonly ffprobeRunner?: FfprobeRunner;
  private readonly ffprobeTimeoutMs: number;

  constructor(params: {
    artifactStore: ArtifactStore;
    ffprobeRunner?: FfprobeRunner;
    ffprobeTimeoutMs?: number;
  }) {
    this.artifactStore = params.artifactStore;
    this.ffprobeRunner = params.ffprobeRunner;
    this.ffprobeTimeoutMs = params.ffprobeTimeoutMs ?? 10_000;
  }

  public async verifyDownloadedArtifact(
    artifactId: string,
    policy: CompletionPolicy
  ): Promise<{ artifact: ArtifactRecord; chainLink: ArtifactChainLink | null }> {
    const current = this.artifactStore.getArtifactById(artifactId);
    const req = policy.technicalRequirements;

    if (!fs.existsSync(current.finalPath)) {
      return this.artifactStore.recordVerificationOutcome({
        artifactId,
        verified: false,
        rejectionReason: 'Arquivo fisico nao encontrado em finalPath.',
      });
    }

    const lstat = fs.lstatSync(current.finalPath);
    if (lstat.isSymbolicLink() || !lstat.isFile()) {
      return this.artifactStore.recordVerificationOutcome({
        artifactId,
        verified: false,
        rejectionReason: 'Arquivo fisico e um symlink ou nao e arquivo regular (S-08).',
      });
    }

    const sizeBytes = lstat.size;
    if (sizeBytes < req.minSizeBytes) {
      return this.artifactStore.recordVerificationOutcome({
        artifactId,
        verified: false,
        sizeBytes,
        rejectionReason: `Tamanho do arquivo (${sizeBytes} bytes) menor que o minimo exigido (${req.minSizeBytes} bytes).`,
      });
    }

    const fileBuffer = fs.readFileSync(current.finalPath);
    const headerSlice = fileBuffer.subarray(0, 16);
    if (!hasValidContainerMagicBytes(headerSlice, req.expectedContainer)) {
      return this.artifactStore.recordVerificationOutcome({
        artifactId,
        verified: false,
        sizeBytes,
        rejectionReason: `Assinatura binaria (Magic Bytes) invalida para container '${req.expectedContainer}' — possivel pagina de erro HTML ou arquivo truncado (BC-14).`,
      });
    }

    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    let durationSec: number | null = null;
    let width: number | null = null;
    let height: number | null = null;
    let containerFormat: string = req.expectedContainer;

    if (this.ffprobeRunner) {
      try {
        const meta = await this.ffprobeRunner(current.finalPath, {
          shell: false,
          timeout: this.ffprobeTimeoutMs,
        });
        containerFormat = meta.containerFormat;
        durationSec = meta.durationSec;
        width = meta.width;
        height = meta.height;

        if (req.minDurationSec !== undefined && durationSec < req.minDurationSec) {
          return this.artifactStore.recordVerificationOutcome({
            artifactId,
            verified: false,
            sizeBytes,
            sha256,
            containerFormat,
            durationSec,
            width,
            height,
            rejectionReason: `Duracao observada (${durationSec}s) menor que minDurationSec (${req.minDurationSec}s).`,
          });
        }

        if (
          (req.expectedWidth !== undefined && width !== req.expectedWidth) ||
          (req.expectedHeight !== undefined && height !== req.expectedHeight)
        ) {
          return this.artifactStore.recordVerificationOutcome({
            artifactId,
            verified: false,
            sizeBytes,
            sha256,
            containerFormat,
            durationSec,
            width,
            height,
            rejectionReason: `Resolucao observada (${width}x${height}) diverge da esperada (${req.expectedWidth}x${req.expectedHeight}).`,
          });
        }
      } catch (err) {
        return this.artifactStore.recordVerificationOutcome({
          artifactId,
          verified: false,
          sizeBytes,
          sha256,
          rejectionReason: `Falha na inspecao tecnica ffprobe: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    return this.artifactStore.recordVerificationOutcome({
      artifactId,
      verified: true,
      sizeBytes,
      sha256,
      containerFormat,
      durationSec,
      width,
      height,
    });
  }
}
