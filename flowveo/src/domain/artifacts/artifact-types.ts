import { z } from 'zod';

export const ArtifactStatusSchema = z.enum([
  'PLANNED',
  'DOWNLOADING',
  'DOWNLOADED',
  'VERIFYING',
  'VERIFIED',
  'REJECTED',
  'MISSING',
]);

export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;

export interface ArtifactRecord {
  artifactId: string;
  jobId: string;
  submissionIntentId: string;
  remoteSubmissionId: string;
  remoteResultId: string;
  downloadPermitId: string;
  internalFilename: string;
  remoteFilenameSanitized: string;
  stagingPath: string;
  finalPath: string;
  status: ArtifactStatus;
  sizeBytes: number | null;
  sha256: string | null;
  containerFormat: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactChainLink {
  linkId: string;
  artifactId: string;
  jobId: string;
  submissionIntentId: string;
  remoteSubmissionId: string;
  remoteResultId: string;
  verifiedChainDigest: string;
  linkedAt: string;
}
