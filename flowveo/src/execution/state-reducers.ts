import type { ArtifactStatus } from '../domain/artifacts/artifact-types.js';
import type { CompletionPolicy, JobStatus } from '../domain/jobs/job-types.js';
import type { RemoteResultStatus } from '../domain/results/result-types.js';
import type { SubmissionIntentStatus } from '../domain/submissions/submission-types.js';

/**
 * Reducers Determinísticos e Separados de Estado (Arquitetura §12 / BC-07, BC-11, BC-12):
 * - PLANNED -> RESERVED -> DISPATCHING -> CONFIRMED
 * - DISPATCHING -> UNKNOWN -> RECONCILING -> CONFIRMED | NEEDS_REVIEW
 * - Antes de DISPATCHING (PLANNED ou RESERVED), pode ser ABORTED.
 * - Depois de DISPATCHING, ausencia de confirmacao NUNCA autoriza transitar para ABORTED sem evidencia provada!
 * - RemoteResult pode avancar direto de OBSERVED para READY na retomada sem inventar PROCESSING (BC-12).
 */

const ALLOWED_INTENT_TRANSITIONS: Readonly<
  Record<SubmissionIntentStatus, ReadonlySet<SubmissionIntentStatus>>
> = {
  PLANNED: new Set<SubmissionIntentStatus>(['RESERVED', 'ABORTED']),
  RESERVED: new Set<SubmissionIntentStatus>(['DISPATCHING', 'ABORTED']),
  DISPATCHING: new Set<SubmissionIntentStatus>(['CONFIRMED', 'UNKNOWN']),
  UNKNOWN: new Set<SubmissionIntentStatus>(['RECONCILING', 'NEEDS_REVIEW']),
  RECONCILING: new Set<SubmissionIntentStatus>(['CONFIRMED', 'NEEDS_REVIEW', 'UNKNOWN']),
  CONFIRMED: new Set<SubmissionIntentStatus>([]),
  NEEDS_REVIEW: new Set<SubmissionIntentStatus>(['RECONCILING', 'CONFIRMED']),
  ABORTED: new Set<SubmissionIntentStatus>([]),
};

export function reduceSubmissionIntentStatus(
  current: SubmissionIntentStatus,
  next: SubmissionIntentStatus,
  evidenceReason: string
): SubmissionIntentStatus {
  if (!evidenceReason || evidenceReason.trim().length === 0) {
    throw new Error('Toda transicao de SubmissionIntent exige motivo/evidencia explicita.');
  }
  const allowed = ALLOWED_INTENT_TRANSITIONS[current];
  if (!allowed || !allowed.has(next)) {
    throw new Error(
      `Transicao ilegal de SubmissionIntent: '${current}' -> '${next}'. Depois de DISPATCHING, proibido abortar ou resetar sem reconciliacao (Arquitetura §12).`
    );
  }
  return next;
}

const ALLOWED_RESULT_TRANSITIONS: Readonly<
  Record<RemoteResultStatus, ReadonlySet<RemoteResultStatus>>
> = {
  // Regra BC-12 / Arquitetura §12: OBSERVED pode ir direto para READY ao reencontrar resultado pronto!
  OBSERVED: new Set<RemoteResultStatus>(['PROCESSING', 'READY', 'FAILED_REMOTE', 'UNKNOWN']),
  PROCESSING: new Set<RemoteResultStatus>(['READY', 'FAILED_REMOTE', 'UNKNOWN']),
  UNKNOWN: new Set<RemoteResultStatus>(['PROCESSING', 'READY', 'FAILED_REMOTE']),
  READY: new Set<RemoteResultStatus>([]),
  FAILED_REMOTE: new Set<RemoteResultStatus>([]),
};

export function reduceRemoteResultStatus(
  current: RemoteResultStatus,
  next: RemoteResultStatus,
  evidenceReason: string
): RemoteResultStatus {
  if (!evidenceReason || evidenceReason.trim().length === 0) {
    throw new Error('Toda transicao de RemoteResult exige evidencia explicita.');
  }
  if (current === next) return current;
  const allowed = ALLOWED_RESULT_TRANSITIONS[current];
  if (!allowed || !allowed.has(next)) {
    throw new Error(`Transicao ilegal de RemoteResult: '${current}' -> '${next}'.`);
  }
  return next;
}

/**
 * Avalia a conclusao do Job com base na CompletionPolicy (Arquitetura §11 / BC-10, BC-11):
 * - Estado parcial NUNCA e COMPLETED.
 * - COMPLETED exige que TODAS as saidas solicitadas (requestedOutputs) estejam VERIFIED.
 */
export function evaluateJobCompletionStatus(params: {
  requestedOutputs: number;
  verifiedArtifactsCount: number;
  failedOrRejectedCount: number;
  policy: CompletionPolicy;
}): JobStatus {
  const { requestedOutputs, verifiedArtifactsCount, failedOrRejectedCount, policy } = params;

  if (verifiedArtifactsCount >= requestedOutputs && failedOrRejectedCount === 0) {
    return 'COMPLETED';
  }

  if (
    verifiedArtifactsCount > 0 &&
    verifiedArtifactsCount >= policy.minVerifiedOutputs &&
    policy.allowPartial
  ) {
    // Regra Arquitetura §11: Estado parcial NAO e COMPLETED!
    return 'PARTIAL';
  }

  return 'FAILED';
}

const ALLOWED_ARTIFACT_TRANSITIONS: Readonly<
  Record<ArtifactStatus, ReadonlySet<ArtifactStatus>>
> = {
  PLANNED: new Set<ArtifactStatus>(['DOWNLOADING', 'REJECTED', 'MISSING']),
  DOWNLOADING: new Set<ArtifactStatus>(['DOWNLOADED', 'REJECTED', 'MISSING']),
  DOWNLOADED: new Set<ArtifactStatus>(['VERIFYING', 'MISSING']),
  VERIFYING: new Set<ArtifactStatus>(['VERIFIED', 'REJECTED', 'MISSING']),
  VERIFIED: new Set<ArtifactStatus>(['MISSING']),
  REJECTED: new Set<ArtifactStatus>([]),
  MISSING: new Set<ArtifactStatus>([]),
};

export function reduceArtifactStatus(
  current: ArtifactStatus,
  next: ArtifactStatus
): ArtifactStatus {
  if (current === next) return current;
  const allowed = ALLOWED_ARTIFACT_TRANSITIONS[current];
  if (!allowed || !allowed.has(next)) {
    throw new Error(`Transicao ilegal de ArtifactStatus: '${current}' -> '${next}'.`);
  }
  return next;
}
