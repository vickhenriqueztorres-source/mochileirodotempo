import { z } from 'zod';
import type {
  ActionKind,
  ActionOutcome,
  ActionPlan,
  AuthorizationDecision,
} from '../domain/actions/action-types.js';
import type { OperationMode } from '../shared/config-schema.js';

export const ContextSnapshotSchema = z
  .object({
    controllerEpoch: z.number().int().positive(),
    sessionEpoch: z.number().int().positive(),
    pageId: z.string().min(1),
    url: z.string().url(),
    locale: z.string().min(2),
    viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
    accountContextId: z.string().min(1),
    projectContextId: z.string().min(1),
    creationMode: z.string().min(1),
    observedVariant: z.string().min(1),
    observedRevision: z.number().int().nonnegative(),
    isAuthenticated: z.boolean(),
    hasCaptchaOrVerification: z.boolean(),
    humanInterferenceDetected: z.boolean().default(false),
  })
  .strict();

export type ContextSnapshot = z.infer<typeof ContextSnapshotSchema>;

export const CreationSnapshotSchema = z
  .object({
    selectedModel: z.string(),
    selectedAspectRatio: z.string(),
    selectedOutputsCount: z.number().int().positive(),
    promptText: z.string(),
    promptDigestSha256: z.string().length(64),
    uploadReadyFilename: z.string().nullable(),
    observedConfigDigest: z.string().length(64),
    observedRevision: z.number().int().nonnegative(),
  })
  .strict();

export type CreationSnapshot = z.infer<typeof CreationSnapshotSchema>;

export const ResultObservationSchema = z
  .object({
    remoteExternalId: z.string().nullable(),
    remoteAssetId: z.string().nullable(),
    resultIndex: z.number().int().nonnegative(),
    status: z.enum(['OBSERVED', 'PROCESSING', 'READY', 'FAILED_REMOTE', 'UNKNOWN']),
    promptSnippetDigest: z.string().nullable(),
    createdAtLabel: z.string().nullable(),
    downloadControlId: z.string().nullable(),
  })
  .strict();

export type ResultObservation = z.infer<typeof ResultObservationSchema>;

export interface ActionInput {
  mode: OperationMode;
  actionKind: ActionKind;
  targetControlId: string;
  transitionId: string;
  paramsCanonical: Record<string, unknown>;
  jobId?: string | null;
  attemptId?: string | null;
  submissionIntentId?: string | null;
  registryVersion: string;
  policyVersion: string;
  observedConfigDigest: string;
}

/**
 * Contratos publicos sem acesso direto ao navegador (Arquitetura §9).
 * Page, Locator, BrowserContext e handles do Playwright jamais escapam.
 */
export interface FlowReader {
  inspectContext(): Promise<ContextSnapshot>;
  inspectCreationForm(): Promise<CreationSnapshot>;
  inspectResults(): Promise<{
    isVirtualizedOrPartial: boolean;
    items: ResultObservation[];
  }>;
}

export interface ActionPlanner {
  plan(input: ActionInput, snapshot: ContextSnapshot): ActionPlan;
}

export interface SafetyGateway {
  authorize(plan: ActionPlan, currentSnapshot: ContextSnapshot): Promise<AuthorizationDecision>;
}

export interface AuthorizedExecutor {
  execute(permitId: string): Promise<ActionOutcome>;
}
