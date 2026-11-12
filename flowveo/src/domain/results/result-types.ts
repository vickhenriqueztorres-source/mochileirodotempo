import { z } from 'zod';

export const RemoteResultStatusSchema = z.enum([
  'OBSERVED',
  'PROCESSING',
  'READY',
  'FAILED_REMOTE',
  'UNKNOWN',
]);

export type RemoteResultStatus = z.infer<typeof RemoteResultStatusSchema>;

export interface RemoteResult {
  remoteResultId: string;
  remoteSubmissionId: string;
  resultIndex: number;
  remoteAssetId: string | null;
  status: RemoteResultStatus;
  version: number;
  observedAt: string;
  updatedAt: string;
}
