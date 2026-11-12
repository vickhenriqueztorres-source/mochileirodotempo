import { z } from 'zod';

export const SubmissionIntentStatusSchema = z.enum([
  'PLANNED',
  'RESERVED',
  'DISPATCHING',
  'CONFIRMED',
  'UNKNOWN',
  'RECONCILING',
  'NEEDS_REVIEW',
  'ABORTED',
]);

export type SubmissionIntentStatus = z.infer<typeof SubmissionIntentStatusSchema>;

export interface SubmissionIntent {
  submissionIntentId: string;
  jobId: string;
  attemptId: string;
  status: SubmissionIntentStatus;
  observedConfigDigest: string;
  baselineSnapshotJson: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type CorrelationStatus = 'CONFIRMED' | 'AMBIGUOUS' | 'NOT_OBSERVED';

export interface RemoteSubmission {
  remoteSubmissionId: string;
  submissionIntentId: string;
  scopeId: string;
  remoteExternalId: string | null;
  correlationStatus: CorrelationStatus;
  observedAt: string;
}
