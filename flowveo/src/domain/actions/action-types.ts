import { z } from 'zod';
import { OperationModeSchema } from '../../shared/config-schema.js';

export const ActionKindSchema = z.enum([
  'READ',
  'OPEN_UI',
  'CONFIGURE',
  'FILL',
  'UPLOAD',
  'SUBMIT',
  'DOWNLOAD',
  'LIFECYCLE',
]);

export type ActionKind = z.infer<typeof ActionKindSchema>;

export const PermitStatusSchema = z.enum([
  'ISSUED',
  'CLAIMED',
  'FINISHED',
  'REVOKED',
  'EXPIRED',
]);

export type PermitStatus = z.infer<typeof PermitStatusSchema>;

export const ActionPlanSchema = z
  .object({
    planId: z.string().min(1),
    jobId: z.string().nullable().optional(),
    attemptId: z.string().nullable().optional(),
    submissionIntentId: z.string().nullable().optional(),
    mode: OperationModeSchema,
    actionKind: ActionKindSchema,
    targetControlId: z.string().min(1),
    transitionId: z.string().min(1),
    paramsCanonical: z.record(z.unknown()),
    paramsDigestSha256: z.string().length(64),
    projectContextId: z.string().min(1),
    accountContextId: z.string().min(1),
    registryVersion: z.string().min(1),
    policyVersion: z.string().min(1),
    observedConfigDigest: z.string().length(64),
    observedRevision: z.number().int().nonnegative(),
  })
  .strict();

export type ActionPlan = z.infer<typeof ActionPlanSchema>;

export interface ExecutionPermit {
  permitId: string;
  planId: string;
  nonce: string;
  controllerEpoch: number;
  sessionEpoch: number;
  pageId: string;
  jobId: string | null;
  attemptId: string | null;
  submissionIntentId: string | null;
  actionKind: ActionKind;
  targetControlId: string;
  transitionId: string;
  paramsDigestSha256: string;
  projectContextId: string;
  accountContextId: string;
  registryVersion: string;
  policyVersion: string;
  observedConfigDigest: string;
  observedRevision: number;
  status: PermitStatus;
  issuedAtMs: number;
  expiresAtMs: number;
  monotonicIssuedNs: bigint;
  monotonicExpiresNs: bigint;
}

export type AuthorizationDecision =
  | {
      allowed: true;
      permit: ExecutionPermit;
      reason: string;
    }
  | {
      allowed: false;
      reason: string;
      code: string;
    };

export interface ActionOutcome {
  permitId: string;
  planId: string;
  actionKind: ActionKind;
  status: 'SUCCESS' | 'POSTCONDITION_FAILED' | 'REVOKED_PRE_MUTATION' | 'DRIVER_ERROR';
  observedRevisionAfter: number;
  postconditionVerified: boolean;
  details: Record<string, unknown>;
}
