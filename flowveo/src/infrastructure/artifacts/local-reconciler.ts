import fs from 'node:fs';
import path from 'node:path';
import { ArtifactStore } from './artifact-store.js';

export interface LocalReconciliationReport {
  verifiedIntactCount: number;
  markedMissingArtifactIds: string[];
  orphanFilesOnDisk: string[];
  cleanedStagingPartFiles: string[];
  interruptedDownloadArtifactIds: string[];
}

/**
 * LocalArtifactReconciler (Arquitetura §18 / BC-15):
 * - Detecta registros VERIFIED/DOWNLOADED cujo arquivo sumiu do disco -> marca MISSING.
 * - Detecta arquivos .part abandonados em staging -> limpa .part e reporta download interrompido.
 * - Detecta arquivos fisicos em runtime/artifacts sem registro correspondente no banco -> reporta ORPHAN_FILE.
 * - JAMAIS associa arquivo orfao a um job por semelhanca de nome!
 */
export class LocalArtifactReconciler {
  private readonly artifactStore: ArtifactStore;

  constructor(artifactStore: ArtifactStore) {
    this.artifactStore = artifactStore;
  }

  public reconcile(): LocalReconciliationReport {
    const allRecords = this.artifactStore.listAllArtifacts();
    const knownFinalPaths = new Set<string>();
    const markedMissingArtifactIds: string[] = [];
    const interruptedDownloadArtifactIds: string[] = [];
    let verifiedIntactCount = 0;

    for (const rec of allRecords) {
      const normalizedFinal = path.resolve(rec.finalPath);
      if (rec.status === 'VERIFIED' || rec.status === 'DOWNLOADED') {
        knownFinalPaths.add(normalizedFinal);
        if (!fs.existsSync(normalizedFinal)) {
          this.artifactStore.markArtifactMissing(
            rec.artifactId,
            'Arquivo fisico ausente durante reconciliacao local (BC-15).'
          );
          markedMissingArtifactIds.push(rec.artifactId);
        } else if (rec.status === 'VERIFIED') {
          verifiedIntactCount += 1;
        }
      } else if (rec.status === 'PLANNED' || rec.status === 'DOWNLOADING') {
        interruptedDownloadArtifactIds.push(rec.artifactId);
      }
    }

    // Limpar arquivos .part residuais em staging
    const cleanedStagingPartFiles: string[] = [];
    const stagingDir = this.artifactStore.getStagingBaseDir();
    if (fs.existsSync(stagingDir)) {
      for (const entry of fs.readdirSync(stagingDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.part')) {
          const fullPartPath = path.resolve(stagingDir, entry.name);
          fs.rmSync(fullPartPath, { force: true });
          cleanedStagingPartFiles.push(fullPartPath);
        }
      }
    }

    // Escanear runtime/artifacts recursivamente em busca de arquivos orfaos (sem registro no SQLite)
    const orphanFilesOnDisk: string[] = [];
    const artifactsDir = this.artifactStore.getArtifactsBaseDir();
    this.scanOrphansRecursive(artifactsDir, knownFinalPaths, orphanFilesOnDisk);

    return {
      verifiedIntactCount,
      markedMissingArtifactIds,
      orphanFilesOnDisk,
      cleanedStagingPartFiles,
      interruptedDownloadArtifactIds,
    };
  }

  private scanOrphansRecursive(
    dir: string,
    knownFinalPaths: Set<string>,
    orphanOut: string[]
  ): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.resolve(dir, entry.name);
      if (entry.isDirectory()) {
        this.scanOrphansRecursive(fullPath, knownFinalPaths, orphanOut);
      } else if (entry.isFile()) {
        if (!knownFinalPaths.has(fullPath)) {
          orphanOut.push(fullPath);
        }
      }
    }
  }
}
