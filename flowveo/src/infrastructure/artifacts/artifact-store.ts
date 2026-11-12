import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ArtifactChainLink, ArtifactRecord, ArtifactStatus } from '../../domain/artifacts/artifact-types.js';
import type { RemoteResult, RemoteResultStatus } from '../../domain/results/result-types.js';
import { reduceArtifactStatus, reduceRemoteResultStatus } from '../../execution/state-reducers.js';
import { sha256Hex } from '../observability/redactor.js';
import { FlowDatabase } from '../persistence/database.js';
import { EventRepository } from '../persistence/repositories/event-repository.js';
import { PolicyDeniedError } from '../../shared/errors.js';

export function sanitizeRemoteFilenameMetadata(rawRemoteFilename: string): string {
  const withoutNulls = rawRemoteFilename.replace(/\0/g, '');
  const baseOnly = path.posix.basename(withoutNulls.replace(/\\/g, '/'));
  const cleaned = baseOnly.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_');
  return cleaned.slice(0, 120) || 'unnamed_remote_asset';
}

export interface PlanArtifactInput {
  jobId: string;
  submissionIntentId: string;
  remoteSubmissionId: string;
  remoteResultId: string;
  downloadPermitId: string;
  remoteSuggestedFilename: string;
  expectedExtension?: 'mp4' | 'webm';
}

/**
 * ArtifactStore (Arquitetura §18 / BC-13, S-08):
 * - Impõe cadeia obrigatória jobId -> submissionIntentId -> remoteSubmissionId -> remoteResultId -> downloadPermitId -> artifactId.
 * - Gera nomes físicos internos imunes a path traversal / command injection.
 * - Rejeita symlinks/junctions nos diretórios de staging e artifacts.
 * - Grava em staging (.part) no mesmo filesystem e finaliza por rename atômico.
 */
export class ArtifactStore {
  private readonly flowDb: FlowDatabase;
  private readonly eventRepo: EventRepository;
  private readonly artifactsBaseDir: string;
  private readonly stagingBaseDir: string;

  constructor(params: {
    flowDb: FlowDatabase;
    eventRepo: EventRepository;
    artifactsBaseDir: string;
    stagingBaseDir: string;
  }) {
    this.flowDb = params.flowDb;
    this.eventRepo = params.eventRepo;
    this.artifactsBaseDir = path.resolve(params.artifactsBaseDir);
    this.stagingBaseDir = path.resolve(params.stagingBaseDir);

    this.ensureSafeDirectory(this.artifactsBaseDir);
    this.ensureSafeDirectory(this.stagingBaseDir);
  }

  public getArtifactsBaseDir(): string {
    return this.artifactsBaseDir;
  }

  public getStagingBaseDir(): string {
    return this.stagingBaseDir;
  }

  private ensureSafeDirectory(dirPath: string): string {
    if (fs.existsSync(dirPath)) {
      const stat = fs.lstatSync(dirPath);
      if (stat.isSymbolicLink()) {
        throw new PolicyDeniedError(
          `Diretorio '${dirPath}' e um symlink/junction nao permitido (S-08).`
        );
      }
      if (!stat.isDirectory()) {
        throw new PolicyDeniedError(`Caminho '${dirPath}' nao e um diretorio valido.`);
      }
    } else {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return fs.realpathSync(dirPath);
  }

  private assertPathInsideBase(targetPath: string, realBaseDir: string): void {
    const parentDir = path.dirname(targetPath);
    const realParent = this.ensureSafeDirectory(parentDir);
    const resolvedTarget = path.join(realParent, path.basename(targetPath));

    const rel = path.relative(realBaseDir, resolvedTarget);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new PolicyDeniedError(
        `Violacao de fronteira de caminho detectada: '${targetPath}' escapa de '${realBaseDir}' (S-08).`
      );
    }

    if (fs.existsSync(resolvedTarget)) {
      const st = fs.lstatSync(resolvedTarget);
      if (st.isSymbolicLink()) {
        throw new PolicyDeniedError(
          `Arquivo destino '${resolvedTarget}' e um symlink nao permitido (S-08).`
        );
      }
    }
  }

  /**
   * Registra ou avança o status de um RemoteResult com suporte à transição não-linear OBSERVED -> READY (BC-12).
   */
  public upsertRemoteResult(params: {
    remoteSubmissionId: string;
    resultIndex: number;
    remoteAssetId: string | null;
    status: RemoteResultStatus;
  }): RemoteResult {
    return this.flowDb.writeTransaction((db) => {
      const existing = db
        .prepare(
          `SELECT * FROM remote_results
           WHERE remote_submission_id = ? AND result_index = ?`
        )
        .get(params.remoteSubmissionId, params.resultIndex) as Record<string, unknown> | undefined;

      const nowIso = new Date().toISOString();
      if (!existing) {
        const remoteResultId = `rres_${crypto.randomUUID()}`;
        db.prepare(
          `INSERT INTO remote_results (
            remote_result_id, remote_submission_id, result_index,
            remote_asset_id, status, version, observed_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
        ).run(
          remoteResultId,
          params.remoteSubmissionId,
          params.resultIndex,
          params.remoteAssetId,
          params.status,
          nowIso,
          nowIso
        );
        return this.getRemoteResultById(remoteResultId);
      }

      const currentStatus = existing.status as RemoteResultStatus;
      const nextStatus =
        currentStatus === params.status
          ? currentStatus
          : reduceRemoteResultStatus(
              currentStatus,
              params.status,
              'Observacao remota reconciliada'
            );

      db.prepare(
        `UPDATE remote_results
         SET status = ?, remote_asset_id = COALESCE(?, remote_asset_id),
             version = version + 1, updated_at = ?
         WHERE remote_result_id = ?`
      ).run(nextStatus, params.remoteAssetId, nowIso, String(existing.remote_result_id));

      return this.getRemoteResultById(String(existing.remote_result_id));
    });
  }

  public getRemoteResultById(remoteResultId: string): RemoteResult {
    return this.flowDb.read((db) => {
      const row = db
        .prepare('SELECT * FROM remote_results WHERE remote_result_id = ?')
        .get(remoteResultId) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error(`RemoteResult '${remoteResultId}' nao encontrado.`);
      }
      return {
        remoteResultId: String(row.remote_result_id),
        remoteSubmissionId: String(row.remote_submission_id),
        resultIndex: Number(row.result_index),
        remoteAssetId: row.remote_asset_id ? String(row.remote_asset_id) : null,
        status: row.status as RemoteResultStatus,
        version: Number(row.version),
        observedAt: String(row.observed_at),
        updatedAt: String(row.updated_at),
      };
    });
  }

  /**
   * Passo 1 do Download Seguro: Valida toda a cadeia job -> intent -> submission -> result -> permit
   * e cria o registro PLANNED com nome interno seguro (BC-13, S-08).
   */
  public planArtifactDownload(input: PlanArtifactInput): ArtifactRecord {
    const realArtifactsBase = this.ensureSafeDirectory(this.artifactsBaseDir);
    const realStagingBase = this.ensureSafeDirectory(this.stagingBaseDir);

    if (!/^[a-zA-Z0-9_-]+$/.test(input.jobId)) {
      throw new PolicyDeniedError(`jobId invalido para composicao de diretorio: '${input.jobId}'.`);
    }

    return this.flowDb.writeTransaction((db) => {
      // 1. Verificar integridade da cadeia job -> submission_intent -> remote_submission -> remote_result -> permit (BC-13)
      const intentRow = db
        .prepare(
          'SELECT submission_intent_id, job_id, status FROM submission_intents WHERE submission_intent_id = ?'
        )
        .get(input.submissionIntentId) as
        | { submission_intent_id: string; job_id: string; status: string }
        | undefined;

      if (!intentRow || intentRow.job_id !== input.jobId) {
        throw new PolicyDeniedError(
          `Violacao de cadeia de artefato (BC-13): SubmissionIntent '${input.submissionIntentId}' nao pertence ao Job '${input.jobId}'.`
        );
      }

      const subRow = db
        .prepare(
          'SELECT remote_submission_id, submission_intent_id, correlation_status FROM remote_submissions WHERE remote_submission_id = ?'
        )
        .get(input.remoteSubmissionId) as
        | {
            remote_submission_id: string;
            submission_intent_id: string;
            correlation_status: string;
          }
        | undefined;

      if (
        !subRow ||
        subRow.submission_intent_id !== input.submissionIntentId ||
        subRow.correlation_status !== 'CONFIRMED'
      ) {
        throw new PolicyDeniedError(
          `Violacao de cadeia de artefato (BC-13): RemoteSubmission '${input.remoteSubmissionId}' nao esta CONFIRMED para a intencao '${input.submissionIntentId}'.`
        );
      }

      const resRow = db
        .prepare(
          'SELECT remote_result_id, remote_submission_id, result_index, status FROM remote_results WHERE remote_result_id = ?'
        )
        .get(input.remoteResultId) as
        | {
            remote_result_id: string;
            remote_submission_id: string;
            result_index: number;
            status: string;
          }
        | undefined;

      if (!resRow || resRow.remote_submission_id !== input.remoteSubmissionId) {
        throw new PolicyDeniedError(
          `Violacao de cadeia de artefato (BC-13): RemoteResult '${input.remoteResultId}' nao pertence a RemoteSubmission '${input.remoteSubmissionId}'.`
        );
      }

      if (resRow.status !== 'READY') {
        throw new PolicyDeniedError(
          `RemoteResult '${input.remoteResultId}' nao esta READY (status=${resRow.status}).`
        );
      }

      const permitRow = db
        .prepare(
          'SELECT permit_id, job_id, action_kind FROM execution_permits WHERE permit_id = ?'
        )
        .get(input.downloadPermitId) as
        | { permit_id: string; job_id: string | null; action_kind: string }
        | undefined;

      if (
        !permitRow ||
        permitRow.action_kind !== 'DOWNLOAD' ||
        permitRow.job_id !== input.jobId
      ) {
        throw new PolicyDeniedError(
          `Violacao de cadeia de artefato (BC-13): Permit '${input.downloadPermitId}' nao e uma permissao de DOWNLOAD valida para o Job '${input.jobId}'.`
        );
      }

      const artifactId = `art_${crypto.randomUUID().replace(/-/g, '')}`;
      const ext = input.expectedExtension ?? 'mp4';
      const internalFilename = `${artifactId}_idx${resRow.result_index}.${ext}`;
      const remoteFilenameSanitized = sanitizeRemoteFilenameMetadata(input.remoteSuggestedFilename);

      const jobArtifactsDir = path.join(realArtifactsBase, input.jobId);
      this.ensureSafeDirectory(jobArtifactsDir);

      const stagingPath = path.join(realStagingBase, `${artifactId}.part`);
      const finalPath = path.join(jobArtifactsDir, internalFilename);

      this.assertPathInsideBase(stagingPath, realStagingBase);
      this.assertPathInsideBase(finalPath, realArtifactsBase);

      const nowIso = new Date().toISOString();
      db.prepare(
        `INSERT INTO artifacts (
          artifact_id, job_id, submission_intent_id, remote_submission_id,
          remote_result_id, download_permit_id,
          internal_filename, remote_filename_sanitized,
          staging_path, final_path, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED', ?, ?)`
      ).run(
        artifactId,
        input.jobId,
        input.submissionIntentId,
        input.remoteSubmissionId,
        input.remoteResultId,
        input.downloadPermitId,
        internalFilename,
        remoteFilenameSanitized,
        stagingPath,
        finalPath,
        nowIso,
        nowIso
      );

      return this.getArtifactById(artifactId);
    });
  }

  /**
   * Passo 2 do Download Seguro: Grava os bytes recebidos em staging/<artifactId>.part e marca DOWNLOADING.
   */
  public writeStagingPart(artifactId: string, content: Buffer): ArtifactRecord {
    const current = this.getArtifactById(artifactId);
    const realStagingBase = this.ensureSafeDirectory(this.stagingBaseDir);
    this.assertPathInsideBase(current.stagingPath, realStagingBase);

    const nextStatus =
      current.status === 'DOWNLOADING'
        ? 'DOWNLOADING'
        : reduceArtifactStatus(current.status, 'DOWNLOADING');

    this.flowDb.writeTransaction((db) => {
      db.prepare(
        'UPDATE artifacts SET status = ?, updated_at = ? WHERE artifact_id = ?'
      ).run(nextStatus, new Date().toISOString(), artifactId);
    });

    fs.writeFileSync(current.stagingPath, content, { flag: 'w' });
    return this.getArtifactById(artifactId);
  }

  /**
   * Passo 3 do Download Seguro: Move atomicamente do staging (.part) para finalPath e marca DOWNLOADED.
   */
  public finalizeStagingToDownloaded(artifactId: string): ArtifactRecord {
    const current = this.getArtifactById(artifactId);
    const realArtifactsBase = this.ensureSafeDirectory(this.artifactsBaseDir);
    const realStagingBase = this.ensureSafeDirectory(this.stagingBaseDir);

    this.assertPathInsideBase(current.stagingPath, realStagingBase);
    this.assertPathInsideBase(current.finalPath, realArtifactsBase);

    if (!fs.existsSync(current.stagingPath)) {
      throw new Error(`Arquivo de staging ausente para o artefato '${artifactId}'.`);
    }

    const nextStatus = reduceArtifactStatus(current.status, 'DOWNLOADED');
    fs.renameSync(current.stagingPath, current.finalPath);

    return this.flowDb.writeTransaction((db) => {
      db.prepare(
        'UPDATE artifacts SET status = ?, updated_at = ? WHERE artifact_id = ?'
      ).run(nextStatus, new Date().toISOString(), artifactId);
      return this.getArtifactById(artifactId);
    });
  }

  /**
   * Registra o resultado da verificação técnica (VERIFYING -> VERIFIED | REJECTED) e cria o ArtifactLink auditável.
   */
  public recordVerificationOutcome(params: {
    artifactId: string;
    verified: boolean;
    sizeBytes?: number;
    sha256?: string;
    containerFormat?: string;
    durationSec?: number | null;
    width?: number | null;
    height?: number | null;
    rejectionReason?: string;
    controllerEpoch?: number;
  }): { artifact: ArtifactRecord; chainLink: ArtifactChainLink | null } {
    return this.flowDb.writeTransaction((db) => {
      const current = this.getArtifactById(params.artifactId);
      const verifyingStatus =
        current.status === 'VERIFYING'
          ? 'VERIFYING'
          : reduceArtifactStatus(current.status, 'VERIFYING');
      const finalStatus = reduceArtifactStatus(
        verifyingStatus,
        params.verified ? 'VERIFIED' : 'REJECTED'
      );
      const nowIso = new Date().toISOString();

      db.prepare(
        `UPDATE artifacts
         SET status = ?, size_bytes = ?, sha256 = ?, container_format = ?,
             duration_sec = ?, width = ?, height = ?, rejection_reason = ?, updated_at = ?
         WHERE artifact_id = ?`
      ).run(
        finalStatus,
        params.sizeBytes ?? null,
        params.sha256 ?? null,
        params.containerFormat ?? null,
        params.durationSec ?? null,
        params.width ?? null,
        params.height ?? null,
        params.rejectionReason ?? null,
        nowIso,
        params.artifactId
      );

      let chainLink: ArtifactChainLink | null = null;
      if (params.verified && params.sha256) {
        const linkId = `lnk_${crypto.randomUUID()}`;
        const verifiedChainDigest = sha256Hex(
          JSON.stringify({
            jobId: current.jobId,
            submissionIntentId: current.submissionIntentId,
            remoteSubmissionId: current.remoteSubmissionId,
            remoteResultId: current.remoteResultId,
            downloadPermitId: current.downloadPermitId,
            artifactId: current.artifactId,
            sha256: params.sha256,
          })
        );

        db.prepare(
          `INSERT INTO artifact_links (
            link_id, artifact_id, job_id, submission_intent_id,
            remote_submission_id, remote_result_id, verified_chain_digest, linked_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          linkId,
          current.artifactId,
          current.jobId,
          current.submissionIntentId,
          current.remoteSubmissionId,
          current.remoteResultId,
          verifiedChainDigest,
          nowIso
        );

        chainLink = {
          linkId,
          artifactId: current.artifactId,
          jobId: current.jobId,
          submissionIntentId: current.submissionIntentId,
          remoteSubmissionId: current.remoteSubmissionId,
          remoteResultId: current.remoteResultId,
          verifiedChainDigest,
          linkedAt: nowIso,
        };

        this.eventRepo.insertWithinTransaction(db, {
          eventType: 'artifact.verified',
          correlationId: current.artifactId,
          jobId: current.jobId,
          controllerEpoch: params.controllerEpoch ?? 1,
          policyVersion: '1.0.0',
          registryVersion: 'ACTIVE',
          reason: `Artefato '${current.internalFilename}' verificado com sucesso`,
          payload: {
            artifactId: current.artifactId,
            remoteResultId: current.remoteResultId,
            sha256: params.sha256,
            sizeBytes: params.sizeBytes,
          },
        });
      } else {
        this.eventRepo.insertWithinTransaction(db, {
          eventType: 'artifact.rejected',
          correlationId: current.artifactId,
          jobId: current.jobId,
          controllerEpoch: params.controllerEpoch ?? 1,
          policyVersion: '1.0.0',
          registryVersion: 'ACTIVE',
          reason: params.rejectionReason ?? 'Falha na verificacao tecnica do artefato',
          payload: {
            artifactId: current.artifactId,
            remoteResultId: current.remoteResultId,
          },
        });
      }

      return {
        artifact: this.getArtifactById(params.artifactId),
        chainLink,
      };
    });
  }

  public markArtifactMissing(artifactId: string, reason: string): ArtifactRecord {
    return this.flowDb.writeTransaction((db) => {
      const current = this.getArtifactById(artifactId);
      const nextStatus = reduceArtifactStatus(current.status, 'MISSING');
      db.prepare(
        'UPDATE artifacts SET status = ?, rejection_reason = ?, updated_at = ? WHERE artifact_id = ?'
      ).run(nextStatus, reason, new Date().toISOString(), artifactId);
      return this.getArtifactById(artifactId);
    });
  }

  public getArtifactById(artifactId: string): ArtifactRecord {
    return this.flowDb.read((db) => {
      const row = db
        .prepare('SELECT * FROM artifacts WHERE artifact_id = ?')
        .get(artifactId) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error(`Artifact '${artifactId}' nao encontrado.`);
      }
      return this.mapArtifactRow(row);
    });
  }

  public listArtifactsByJob(jobId: string): ArtifactRecord[] {
    return this.flowDb.read((db) => {
      const rows = db
        .prepare('SELECT * FROM artifacts WHERE job_id = ? ORDER BY created_at ASC')
        .all(jobId) as Array<Record<string, unknown>>;
      return rows.map((r) => this.mapArtifactRow(r));
    });
  }

  public listAllArtifacts(): ArtifactRecord[] {
    return this.flowDb.read((db) => {
      const rows = db
        .prepare('SELECT * FROM artifacts ORDER BY created_at ASC')
        .all() as Array<Record<string, unknown>>;
      return rows.map((r) => this.mapArtifactRow(r));
    });
  }

  private mapArtifactRow(row: Record<string, unknown>): ArtifactRecord {
    return {
      artifactId: String(row.artifact_id),
      jobId: String(row.job_id),
      submissionIntentId: String(row.submission_intent_id),
      remoteSubmissionId: String(row.remote_submission_id),
      remoteResultId: String(row.remote_result_id),
      downloadPermitId: String(row.download_permit_id),
      internalFilename: String(row.internal_filename),
      remoteFilenameSanitized: String(row.remote_filename_sanitized),
      stagingPath: String(row.staging_path),
      finalPath: String(row.final_path),
      status: row.status as ArtifactStatus,
      sizeBytes: row.size_bytes !== null ? Number(row.size_bytes) : null,
      sha256: row.sha256 ? String(row.sha256) : null,
      containerFormat: row.container_format ? String(row.container_format) : null,
      durationSec: row.duration_sec !== null ? Number(row.duration_sec) : null,
      width: row.width !== null ? Number(row.width) : null,
      height: row.height !== null ? Number(row.height) : null,
      rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
