import { z } from 'zod';

export const JobPhaseSchema = z.enum([
  'PREFLIGHT',
  'PREPARING',
  'SUBMITTING',
  'AWAITING_RESULTS',
  'COLLECTING',
  'VERIFYING',
  'DONE',
]);
export type JobPhase = z.infer<typeof JobPhaseSchema>;

export const JobStatusSchema = z.enum([
  'QUEUED',
  'ACTIVE',
  'PAUSED',
  'NEEDS_REVIEW',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'CANCELLED_LOCAL',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const PauseReasonSchema = z.enum([
  'AUTH',
  'POLICY',
  'UI_DRIFT',
  'UNKNOWN_STATE',
  'CONTROLLER_LOST',
  'USER',
]);
export type PauseReason = z.infer<typeof PauseReasonSchema>;

export const CompletionPolicySchema = z
  .object({
    minVerifiedOutputs: z.number().int().min(1),
    allowPartial: z.boolean(),
    technicalRequirements: z
      .object({
        minSizeBytes: z.number().int().min(1024),
        expectedContainer: z.enum(['mp4', 'webm']).default('mp4'),
        minDurationSec: z.number().positive().optional(),
        expectedWidth: z.number().int().positive().optional(),
        expectedHeight: z.number().int().positive().optional(),
      })
      .strict(),
  })
  .strict();

export type CompletionPolicy = z.infer<typeof CompletionPolicySchema>;

export const CreateJobInputSchema = z
  .object({
    jobId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{3,80}$/)
      .optional(),
    payloadVersion: z.number().int().positive().default(1),
    prompt: z.string().min(1),
    model: z.string().min(1),
    aspectRatio: z.string().min(1),
    requestedOutputs: z.number().int().min(1).max(8),
    startFramePath: z.string().nullable().optional(),
    projectContextId: z.string().min(1),
    accountContextId: z.string().min(1),
    completionPolicy: CompletionPolicySchema,
  })
  .strict();

export type CreateJobInput = z.input<typeof CreateJobInputSchema>;

export interface Job {
  jobId: string;
  payloadVersion: number;
  promptDigestSha256: string;
  promptEncryptedOrRef: string;
  model: string;
  aspectRatio: string;
  requestedOutputs: number;
  startFramePath: string | null;
  projectContextId: string;
  accountContextId: string;
  completionPolicy: CompletionPolicy;
  phase: JobPhase;
  status: JobStatus;
  pauseReason: PauseReason | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
