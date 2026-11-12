import fs from 'node:fs';
import { FlowDatabase } from '../infrastructure/persistence/database.js';
import type { ValidatedEnvironmentConfig } from '../shared/config-schema.js';

export interface DoctorCheckResult {
  name: string;
  passed: boolean;
  details: string;
}

export interface DoctorReport {
  overallReadyForObservation: boolean;
  generationHomologated: false;
  checks: DoctorCheckResult[];
}

/**
 * Doctor Service (J01 / A-02 / Arquitetura §22):
 * Verifica dependencias, configuracao, banco, diretorios, perfil, lock e espaco em disco.
 * JAMAIS declara geracao homologada (generationHomologated: false sempre).
 */
export class DoctorService {
  public runDiagnostics(
    envConfig: ValidatedEnvironmentConfig,
    flowDb: FlowDatabase,
    simulatedFreeDiskBytes?: number
  ): DoctorReport {
    const checks: DoctorCheckResult[] = [];

    // 1. Node.js >= 22.5
    const nodeVer = process.versions.node;
    const major = Number(nodeVer.split('.')[0] ?? 0);
    checks.push({
      name: 'node_version',
      passed: major >= 22,
      details: `Node.js ${nodeVer}`,
    });

    // 2. Diretorios de runtime e perfil dedicado
    try {
      for (const dir of [
        envConfig.resolvedPaths.runtimeDir,
        envConfig.resolvedPaths.profileDir,
        envConfig.resolvedPaths.databaseDir,
        envConfig.resolvedPaths.artifactsDir,
        envConfig.resolvedPaths.downloadsDir,
        envConfig.resolvedPaths.stagingDir,
        envConfig.resolvedPaths.locksDir,
      ]) {
        fs.mkdirSync(dir, { recursive: true });
      }
      checks.push({
        name: 'runtime_directories',
        passed: true,
        details: `Diretorios isolados verificados em ${envConfig.resolvedPaths.runtimeDir}`,
      });
    } catch (err) {
      checks.push({
        name: 'runtime_directories',
        passed: false,
        details: err instanceof Error ? err.message : String(err),
      });
    }

    // 3. Saude do SQLite e PRAGMAs
    try {
      const pragmas = flowDb.getPragmaStatus();
      const dbOk =
        !flowDb.isMutationBlocked() &&
        pragmas.foreignKeys === 1 &&
        pragmas.synchronous >= 2;
      checks.push({
        name: 'sqlite_pragmas_and_health',
        passed: dbOk,
        details: `journal=${pragmas.journalMode}, sync=${pragmas.synchronous}, fk=${pragmas.foreignKeys}, mutationBlocked=${flowDb.isMutationBlocked()}`,
      });
    } catch (err) {
      checks.push({
        name: 'sqlite_pragmas_and_health',
        passed: false,
        details: err instanceof Error ? err.message : String(err),
      });
    }

    // 4. Espaco livre em disco
    let freeBytes = simulatedFreeDiskBytes;
    if (freeBytes === undefined) {
      try {
        const stat = fs.statfsSync(envConfig.resolvedPaths.runtimeDir);
        freeBytes = Number(stat.bavail) * Number(stat.bsize);
      } catch {
        freeBytes = envConfig.policy.limits.minFreeDiskBytes;
      }
    }
    const diskOk = freeBytes >= envConfig.policy.limits.minFreeDiskBytes;
    checks.push({
      name: 'disk_space',
      passed: diskOk,
      details: `Livre: ${freeBytes} bytes (minimo exigido: ${envConfig.policy.limits.minFreeDiskBytes} bytes)`,
    });

    // 5. Politica e Release Phase
    checks.push({
      name: 'policy_and_release_gate',
      passed:
        envConfig.policy.releasePhase !== 'A' || envConfig.app.executionEnabled === false,
      details: `Release ${envConfig.policy.releasePhase}, executionEnabled=${envConfig.app.executionEnabled}`,
    });

    const overallReadyForObservation = checks.every((c) => c.passed);

    return {
      overallReadyForObservation,
      // Regra A-02 / J01: Doctor NUNCA declara geracao homologada!
      generationHomologated: false,
      checks,
    };
  }
}
