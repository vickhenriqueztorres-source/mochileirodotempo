import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigValidationError } from '../../shared/errors.js';

export function computeFileSha256(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Garante que um MP4 recém-baixado do Google Flow não seja cópia binária (mesmo card/tile)
 * de nenhum outro take já salvo no diretório do episódio.
 */
export function assertUniqueDownloadedTake(params: {
  candidatePath: string;
  targetTakeNumber: number;
  takesDir: string;
}): string {
  const { candidatePath, targetTakeNumber, takesDir } = params;
  if (!fs.existsSync(candidatePath)) {
    throw new ConfigValidationError(`Arquivo candidato nao encontrado: ${candidatePath}`);
  }

  const candidateHash = computeFileSha256(candidatePath);
  const targetFilename = `take_${String(targetTakeNumber).padStart(2, '0')}.mp4`;

  const existingFiles = fs
    .readdirSync(takesDir)
    .filter((f) => /^take_\d+\.mp4$/i.test(f) && f.toLowerCase() !== targetFilename.toLowerCase());

  for (const existingFile of existingFiles) {
    const existingFullPath = path.join(takesDir, existingFile);
    if (!fs.existsSync(existingFullPath) || fs.statSync(existingFullPath).size <= 0) {
      continue;
    }
    const existingHash = computeFileSha256(existingFullPath);
    if (existingHash === candidateHash) {
      try {
        fs.unlinkSync(candidatePath);
      } catch {
        // ignore cleanup failure
      }
      throw new ConfigValidationError(
        `BLOQUEIO DE TAKE REPETIDO NO DOWNLOAD: O arquivo baixado para ${targetFilename} possui exatamente o mesmo SHA-256 (${candidateHash.slice(0, 12)}...) do arquivo ja existente ${existingFile}. Download duplicado rejeitado.`
      );
    }
  }

  return candidateHash;
}

/**
 * Garante que a lista de takes para montagem (concat) não contenha:
 * 1. Nenhum caminho de arquivo repetido (ex.: proibido reutilizar takes do meio do episódio como Cold Open/Hook).
 * 2. Nenhum arquivo diferente com o mesmo conteúdo binário SHA-256.
 */
export function assertNoRepeatedTakesInTimeline(takePaths: ReadonlyArray<string>): {
  uniqueCount: number;
  digestsByPath: Record<string, string>;
} {
  if (takePaths.length === 0) {
    throw new ConfigValidationError('A lista de takes para montagem nao pode ser vazia.');
  }

  const seenResolvedPaths = new Map<string, number>();
  const seenHashes = new Map<string, { firstIndex: number; firstPath: string }>();
  const digestsByPath: Record<string, string> = {};

  for (let idx = 0; idx < takePaths.length; idx++) {
    const rawPath = takePaths[idx];
    if (!rawPath) {
      throw new ConfigValidationError(`Caminho de take vazio na posicao ${idx + 1}.`);
    }
    const resolved = path.resolve(rawPath).toLowerCase();

    const prevPathIdx = seenResolvedPaths.get(resolved);
    if (prevPathIdx !== undefined) {
      throw new ConfigValidationError(
        `BLOQUEIO DE TAKE REPETIDO NA TIMELINE: O arquivo "${path.basename(rawPath)}" foi incluido mais de uma vez na montagem (posicoes ${prevPathIdx + 1} e ${idx + 1}). Proibido reutilizar takes do corpo do video no Cold Open ou repetir takes.`
      );
    }
    seenResolvedPaths.set(resolved, idx);

    if (!fs.existsSync(rawPath)) {
      throw new ConfigValidationError(`Take inexistente na lista de montagem: ${rawPath}`);
    }

    const sha256 = computeFileSha256(rawPath);
    const prevHash = seenHashes.get(sha256);
    if (prevHash !== undefined) {
      throw new ConfigValidationError(
        `BLOQUEIO DE CONTEUDO DUPLICADO NA TIMELINE: Os arquivos "${path.basename(prevHash.firstPath)}" (posicao ${prevHash.firstIndex + 1}) e "${path.basename(rawPath)}" (posicao ${idx + 1}) possuem o mesmo SHA-256 (${sha256.slice(0, 12)}...). Proibido concatenar takes repetidos.`
      );
    }
    seenHashes.set(sha256, { firstIndex: idx, firstPath: rawPath });
    digestsByPath[rawPath] = sha256;
  }

  return {
    uniqueCount: takePaths.length,
    digestsByPath,
  };
}

/**
 * Valida ausência total de takes repetidos (por caminho e por SHA-256) e grava o arquivo concat_list.txt.
 */
export function writeVerifiedConcatList(
  takePaths: ReadonlyArray<string>,
  concatListPath: string
): { uniqueCount: number; digestsByPath: Record<string, string> } {
  const verification = assertNoRepeatedTakesInTimeline(takePaths);
  const content = takePaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(concatListPath, content, 'utf8');
  return verification;
}
