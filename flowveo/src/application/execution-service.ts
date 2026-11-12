import type { ActionOutcome, ActionPlan } from '../domain/actions/action-types.js';
import type { Job } from '../domain/jobs/job-types.js';
import type { CorrelationDecision } from '../execution/remote-reconciler.js';
import { RemoteReconciler } from '../execution/remote-reconciler.js';
import { SubmissionLedger } from '../execution/submission-ledger.js';
import { computeObservedConfigDigest } from '../flow/action-planner.js';
import type {
  ActionPlanner,
  AuthorizedExecutor,
  FlowReader,
  SafetyGateway,
} from '../flow/contracts.js';
import type { OperationMode } from '../shared/config-schema.js';
import { PermitInvalidError, PolicyDeniedError } from '../shared/errors.js';

export interface DryRunReport {
  jobId: string;
  mode: 'dry-run';
  plannedSteps: ActionPlan[];
  expectedObservedConfigDigest: string;
  mutationsExecuted: 0;
}

export interface PrepareJobResult {
  job: Job;
  observedConfigDigest: string;
  executedOutcomes: ActionOutcome[];
}

export interface SubmissionExecutionResult {
  job: Job;
  submissionIntentId: string;
  outcomeStatus: 'CONFIRMED' | 'UNKNOWN_AMBIGUOUS' | 'UNKNOWN_NOT_OBSERVED' | 'UNKNOWN_ERROR';
  correlationDecision: CorrelationDecision | null;
}

export interface ExecutionServiceDeps {
  reader: FlowReader;
  planner: ActionPlanner;
  safetyGateway: SafetyGateway;
  executor: AuthorizedExecutor;
  ledger: SubmissionLedger;
  reconciler: RemoteReconciler;
  registryVersion: string;
  policyVersion: string;
  mode: OperationMode;
  allowLevel2CombinedCorrelation?: boolean;
}

/**
 * ExecutionService (Arquitetura §9, §13, §14 / BC-02, BC-03, BC-04, BC-07, BC-08, S-03):
 * - dryRunJob: planeja toda a cadeia com 0 chamadas ao executor/driver.
 * - prepareJob: caso de uso composto onde cada CONFIGURE, FILL e UPLOAD exige plano + permit + releitura.
 * - executeSingleSubmission: protocolo de 10 passos com releitura final pre-envio e zero reenvio automatico.
 */
export class ExecutionService {
  private readonly deps: ExecutionServiceDeps;

  constructor(deps: ExecutionServiceDeps) {
    this.deps = deps;
  }

  public async dryRunJob(jobId: string): Promise<DryRunReport> {
    const job = this.deps.ledger.getJobById(jobId);
    const ctx = await this.deps.reader.inspectContext();
    const expectedDigest = computeObservedConfigDigest({
      projectContextId: job.projectContextId,
      model: job.model,
      aspectRatio: job.aspectRatio,
      requestedOutputs: job.requestedOutputs,
      promptDigestSha256: job.promptDigestSha256,
    });

    const plannedSteps: ActionPlan[] = [];

    plannedSteps.push(
      this.deps.planner.plan(
        {
          mode: 'dry-run',
          actionKind: 'CONFIGURE',
          targetControlId: 'ctrl_model_selector',
          transitionId: 'tr_configure_model',
          paramsCanonical: { model: job.model },
          jobId: job.jobId,
          registryVersion: this.deps.registryVersion,
          policyVersion: this.deps.policyVersion,
          observedConfigDigest: expectedDigest,
        },
        ctx
      )
    );

    plannedSteps.push(
      this.deps.planner.plan(
        {
          mode: 'dry-run',
          actionKind: 'CONFIGURE',
          targetControlId: 'ctrl_aspect_and_outputs',
          transitionId: 'tr_configure_aspect_outputs',
          paramsCanonical: {
            aspectRatio: job.aspectRatio,
            requestedOutputs: job.requestedOutputs,
          },
          jobId: job.jobId,
          registryVersion: this.deps.registryVersion,
          policyVersion: this.deps.policyVersion,
          observedConfigDigest: expectedDigest,
        },
        ctx
      )
    );

    plannedSteps.push(
      this.deps.planner.plan(
        {
          mode: 'dry-run',
          actionKind: 'FILL',
          targetControlId: 'ctrl_prompt_textarea',
          transitionId: 'tr_fill_prompt',
          paramsCanonical: { promptDigestSha256: job.promptDigestSha256 },
          jobId: job.jobId,
          registryVersion: this.deps.registryVersion,
          policyVersion: this.deps.policyVersion,
          observedConfigDigest: expectedDigest,
        },
        ctx
      )
    );

    if (job.startFramePath) {
      plannedSteps.push(
        this.deps.planner.plan(
          {
            mode: 'dry-run',
            actionKind: 'UPLOAD',
            targetControlId: 'ctrl_start_frame_upload',
            transitionId: 'tr_upload_start_frame',
            paramsCanonical: { startFramePath: job.startFramePath },
            jobId: job.jobId,
            registryVersion: this.deps.registryVersion,
            policyVersion: this.deps.policyVersion,
            observedConfigDigest: expectedDigest,
          },
          ctx
        )
      );
    }

    plannedSteps.push(
      this.deps.planner.plan(
        {
          mode: 'dry-run',
          actionKind: 'SUBMIT',
          targetControlId: 'ctrl_submit_generate',
          transitionId: 'tr_submit_generation',
          paramsCanonical: { observedConfigDigest: expectedDigest },
          jobId: job.jobId,
          registryVersion: this.deps.registryVersion,
          policyVersion: this.deps.policyVersion,
          observedConfigDigest: expectedDigest,
        },
        ctx
      )
    );

    return {
      jobId: job.jobId,
      mode: 'dry-run',
      plannedSteps,
      expectedObservedConfigDigest: expectedDigest,
      mutationsExecuted: 0,
    };
  }

  /**
   * prepareCreation (Arquitetura §9 / BC-02, BC-03):
   * Cada acao individual (CONFIGURE modelo, CONFIGURE aspect/outputs, FILL prompt, UPLOAD)
   * passa separadamente por ActionPlanner -> SafetyGateway -> AuthorizedExecutor -> releitura.
   */
  public async prepareJob(jobId: string): Promise<PrepareJobResult> {
    const job = this.deps.ledger.getJobById(jobId);
    this.deps.ledger.updateJobState(jobId, 'PREPARING', 'ACTIVE');

    const executedOutcomes: ActionOutcome[] = [];

    // 1. CONFIGURE Model
    let ctx = await this.deps.reader.inspectContext();
    let form = await this.deps.reader.inspectCreationForm();
    const modelPlan = this.deps.planner.plan(
      {
        mode: this.deps.mode,
        actionKind: 'CONFIGURE',
        targetControlId: 'ctrl_model_selector',
        transitionId: 'tr_configure_model',
        paramsCanonical: { model: job.model },
        jobId: job.jobId,
        registryVersion: this.deps.registryVersion,
        policyVersion: this.deps.policyVersion,
        observedConfigDigest: form.observedConfigDigest,
      },
      ctx
    );
    const modelDecision = await this.deps.safetyGateway.authorize(modelPlan, ctx);
    if (!modelDecision.allowed) {
      throw new PolicyDeniedError(modelDecision.reason, { code: modelDecision.code });
    }
    const modelOutcome = await this.deps.executor.execute(modelDecision.permit.permitId);
    executedOutcomes.push(modelOutcome);
    form = await this.deps.reader.inspectCreationForm();
    if (form.selectedModel !== job.model) {
      throw new PolicyDeniedError(
        `Falha de verificacao pos-CONFIGURE de modelo: esperado '${job.model}', lido '${form.selectedModel}'.`
      );
    }

    // 2. CONFIGURE AspectRatio & RequestedOutputs
    ctx = await this.deps.reader.inspectContext();
    const aspectPlan = this.deps.planner.plan(
      {
        mode: this.deps.mode,
        actionKind: 'CONFIGURE',
        targetControlId: 'ctrl_aspect_and_outputs',
        transitionId: 'tr_configure_aspect_outputs',
        paramsCanonical: {
          aspectRatio: job.aspectRatio,
          requestedOutputs: job.requestedOutputs,
        },
        jobId: job.jobId,
        registryVersion: this.deps.registryVersion,
        policyVersion: this.deps.policyVersion,
        observedConfigDigest: form.observedConfigDigest,
      },
      ctx
    );
    const aspectDecision = await this.deps.safetyGateway.authorize(aspectPlan, ctx);
    if (!aspectDecision.allowed) {
      throw new PolicyDeniedError(aspectDecision.reason, { code: aspectDecision.code });
    }
    const aspectOutcome = await this.deps.executor.execute(aspectDecision.permit.permitId);
    executedOutcomes.push(aspectOutcome);
    form = await this.deps.reader.inspectCreationForm();
    if (
      form.selectedAspectRatio !== job.aspectRatio ||
      form.selectedOutputsCount !== job.requestedOutputs
    ) {
      throw new PolicyDeniedError(
        `Falha de verificacao pos-CONFIGURE de proporcao/quantidade: esperado ${job.aspectRatio}/${job.requestedOutputs}, lido ${form.selectedAspectRatio}/${form.selectedOutputsCount}.`
      );
    }

    // 3. FILL Prompt (com verificacao estrita de digest SHA-256 — BC-03)
    ctx = await this.deps.reader.inspectContext();
    const fillPlan = this.deps.planner.plan(
      {
        mode: this.deps.mode,
        actionKind: 'FILL',
        targetControlId: 'ctrl_prompt_textarea',
        transitionId: 'tr_fill_prompt',
        paramsCanonical: {
          promptText: job.promptEncryptedOrRef,
          promptDigestSha256: job.promptDigestSha256,
        },
        jobId: job.jobId,
        registryVersion: this.deps.registryVersion,
        policyVersion: this.deps.policyVersion,
        observedConfigDigest: form.observedConfigDigest,
      },
      ctx
    );
    const fillDecision = await this.deps.safetyGateway.authorize(fillPlan, ctx);
    if (!fillDecision.allowed) {
      throw new PolicyDeniedError(fillDecision.reason, { code: fillDecision.code });
    }
    const fillOutcome = await this.deps.executor.execute(fillDecision.permit.permitId);
    executedOutcomes.push(fillOutcome);
    form = await this.deps.reader.inspectCreationForm();
    if (form.promptDigestSha256 !== job.promptDigestSha256) {
      this.deps.ledger.updateJobState(jobId, 'PREPARING', 'PAUSED', 'UI_DRIFT');
      throw new PolicyDeniedError(
        `Digest SHA-256 do prompt na UI (${form.promptDigestSha256}) diverge do Job (${job.promptDigestSha256}) — BC-03.`
      );
    }

    // 4. UPLOAD Start Frame (opcional)
    if (job.startFramePath) {
      ctx = await this.deps.reader.inspectContext();
      const uploadPlan = this.deps.planner.plan(
        {
          mode: this.deps.mode,
          actionKind: 'UPLOAD',
          targetControlId: 'ctrl_start_frame_upload',
          transitionId: 'tr_upload_start_frame',
          paramsCanonical: { startFramePath: job.startFramePath },
          jobId: job.jobId,
          registryVersion: this.deps.registryVersion,
          policyVersion: this.deps.policyVersion,
          observedConfigDigest: form.observedConfigDigest,
        },
        ctx
      );
      const uploadDecision = await this.deps.safetyGateway.authorize(uploadPlan, ctx);
      if (!uploadDecision.allowed) {
        throw new PolicyDeniedError(uploadDecision.reason, { code: uploadDecision.code });
      }
      const uploadOutcome = await this.deps.executor.execute(uploadDecision.permit.permitId);
      executedOutcomes.push(uploadOutcome);
      form = await this.deps.reader.inspectCreationForm();
      if (!form.uploadReadyFilename) {
        throw new PolicyDeniedError('Ativo de upload inicial nao ficou pronto na UI.');
      }
    }

    ctx = await this.deps.reader.inspectContext();
    const expectedObservedConfigDigest = computeObservedConfigDigest({
      projectContextId: ctx.projectContextId,
      model: form.selectedModel,
      aspectRatio: form.selectedAspectRatio,
      requestedOutputs: form.selectedOutputsCount,
      promptDigestSha256: form.promptDigestSha256,
    });

    const updatedJob = this.deps.ledger.getJobById(jobId);
    return {
      job: updatedJob,
      observedConfigDigest: expectedObservedConfigDigest,
      executedOutcomes,
    };
  }

  /**
   * Protocolo de Submissao Unica Supervisionada de 10 Passos (Arquitetura §13 / BC-04, BC-07, BC-08, S-03).
   */
  public async executeSingleSubmission(jobId: string): Promise<SubmissionExecutionResult> {
    const job = this.deps.ledger.getJobById(jobId);

    // Passo 1: Inspecionar contexto e formulario preparado
    const ctxBefore = await this.deps.reader.inspectContext();
    const formBefore = await this.deps.reader.inspectCreationForm();

    const expectedDigest = computeObservedConfigDigest({
      projectContextId: job.projectContextId,
      model: job.model,
      aspectRatio: job.aspectRatio,
      requestedOutputs: job.requestedOutputs,
      promptDigestSha256: job.promptDigestSha256,
    });

    if (
      ctxBefore.projectContextId !== job.projectContextId ||
      formBefore.selectedModel !== job.model ||
      formBefore.selectedAspectRatio !== job.aspectRatio ||
      formBefore.selectedOutputsCount !== job.requestedOutputs ||
      formBefore.promptDigestSha256 !== job.promptDigestSha256 ||
      formBefore.observedConfigDigest !== expectedDigest
    ) {
      this.deps.ledger.updateJobState(jobId, 'PREPARING', 'PAUSED', 'POLICY');
      throw new PolicyDeniedError(
        'Configuracao observada na pagina diverge do Job antes de criar SubmissionIntent (BC-04).'
      );
    }

    // Passo 2: Capturar BaselineSnapshot dos resultados visiveis antes do envio
    const baselineObs = await this.deps.reader.inspectResults();
    const baselineSnapshot = {
      capturedAtMs: Date.now(),
      isVirtualizedOrPartial: baselineObs.isVirtualizedOrPartial,
      items: baselineObs.items,
    };

    // Passo 3: Criar SubmissionIntent(RESERVED) e reservar orcamento em transacao atomica (BC-05)
    const { intent } = this.deps.ledger.createIntentAndReserveBudget({
      jobId: job.jobId,
      controllerEpoch: ctxBefore.controllerEpoch,
      observedConfigDigest: expectedDigest,
      baselineSnapshot,
      policyVersion: this.deps.policyVersion,
      registryVersion: this.deps.registryVersion,
    });

    // Passo 4: Emitir plano e autorizar ExecutionPermit para SUBMIT vinculado ao observedConfigDigest
    const submitPlan = this.deps.planner.plan(
      {
        mode: this.deps.mode,
        actionKind: 'SUBMIT',
        targetControlId: 'ctrl_submit_generate',
        transitionId: 'tr_submit_generation',
        paramsCanonical: {
          submissionIntentId: intent.submissionIntentId,
          observedConfigDigest: expectedDigest,
        },
        jobId: job.jobId,
        attemptId: intent.attemptId,
        submissionIntentId: intent.submissionIntentId,
        registryVersion: this.deps.registryVersion,
        policyVersion: this.deps.policyVersion,
        observedConfigDigest: expectedDigest,
      },
      ctxBefore
    );

    const decision = await this.deps.safetyGateway.authorize(submitPlan, ctxBefore);
    if (!decision.allowed) {
      this.deps.ledger.abortBeforeDispatch(
        intent.submissionIntentId,
        decision.reason,
        ctxBefore.controllerEpoch
      );
      throw new PolicyDeniedError(decision.reason, { code: decision.code });
    }

    // Passo 5: Revalidar pagina, contexto, modelo, proporcao, quantidade e prompt imediatamente antes do envio (BC-04 / S-03)
    const ctxPreClick = await this.deps.reader.inspectContext();
    const formPreClick = await this.deps.reader.inspectCreationForm();
    const preClickDigest = computeObservedConfigDigest({
      projectContextId: ctxPreClick.projectContextId,
      model: formPreClick.selectedModel,
      aspectRatio: formPreClick.selectedAspectRatio,
      requestedOutputs: formPreClick.selectedOutputsCount,
      promptDigestSha256: formPreClick.promptDigestSha256,
    });

    if (
      preClickDigest !== expectedDigest ||
      formPreClick.observedConfigDigest !== expectedDigest ||
      ctxPreClick.projectContextId !== job.projectContextId
    ) {
      this.deps.ledger.abortBeforeDispatch(
        intent.submissionIntentId,
        'Divergencia detectada na releitura final pre-SUBMIT (BC-04 / S-03)',
        ctxPreClick.controllerEpoch
      );
      throw new PermitInvalidError(
        'Divergencia detectada na releitura final pre-SUBMIT; submissao abortada antes de DISPATCHING (BC-04).'
      );
    }

    // Passo 6: Marcar DISPATCHING de forma duravel no SQLite imediatamente antes da acao
    this.deps.ledger.markDispatchingBeforeClick(intent.submissionIntentId);

    // Passo 7: Executar UMA UNICA chamada de clique via AuthorizedExecutor (zero retries em SUBMIT — BC-07)
    try {
      const submitOutcome = await this.deps.executor.execute(decision.permit.permitId);
      if (submitOutcome.status !== 'SUCCESS') {
        this.deps.ledger.markUnknownOnPostDispatchFailure({
          submissionIntentId: intent.submissionIntentId,
          reason: `Outcome nao-sucesso apos DISPATCHING: ${submitOutcome.status}`,
          controllerEpoch: ctxPreClick.controllerEpoch,
          policyVersion: this.deps.policyVersion,
          registryVersion: this.deps.registryVersion,
        });
        return {
          job: this.deps.ledger.getJobById(jobId),
          submissionIntentId: intent.submissionIntentId,
          outcomeStatus: 'UNKNOWN_ERROR',
          correlationDecision: null,
        };
      }
    } catch (err) {
      // Se o AuthorizedExecutor revogou ANTES da mutacao (PermitInvalidError na releitura atomica interna),
      // ainda assim, como ja marcamos DISPATCHING, por seguranca fechada so liberamos se tivermos prova de REVOKED.
      // Mas qualquer erro de driver/timeout apos DISPATCHING vai obrigatoriamente para UNKNOWN sem reenviar (BC-07).
      this.deps.ledger.markUnknownOnPostDispatchFailure({
        submissionIntentId: intent.submissionIntentId,
        reason: err instanceof Error ? err.message : String(err),
        controllerEpoch: ctxPreClick.controllerEpoch,
        policyVersion: this.deps.policyVersion,
        registryVersion: this.deps.registryVersion,
      });
      return {
        job: this.deps.ledger.getJobById(jobId),
        submissionIntentId: intent.submissionIntentId,
        outcomeStatus: 'UNKNOWN_ERROR',
        correlationDecision: null,
      };
    }

    // Passo 8: Observar sinais pos-envio e correlacionar o resultado remoto (Arquitetura §14)
    try {
      const postObs = await this.deps.reader.inspectResults();
      const correlation = this.deps.reconciler.evaluateCorrelation({
        baseline: baselineSnapshot,
        currentObservation: {
          observedAtMs: Date.now(),
          isVirtualizedOrPartial: postObs.isVirtualizedOrPartial,
          items: postObs.items,
        },
        expectedPromptDigest: job.promptDigestSha256,
        allowLevel2HomologatedCombinedEvidence: Boolean(
          this.deps.allowLevel2CombinedCorrelation
        ),
      });

      // Passo 9: Se CONFIRMED, persistir correlacao e CONFIRMED em transacao
      if (correlation.status === 'CONFIRMED' && correlation.matchedRemoteExternalId) {
        this.deps.ledger.confirmSubmission({
          submissionIntentId: intent.submissionIntentId,
          scopeId: job.projectContextId,
          remoteExternalId: correlation.matchedRemoteExternalId,
          controllerEpoch: ctxPreClick.controllerEpoch,
          policyVersion: this.deps.policyVersion,
          registryVersion: this.deps.registryVersion,
          ruleApplied: correlation.ruleApplied,
        });
        return {
          job: this.deps.ledger.getJobById(jobId),
          submissionIntentId: intent.submissionIntentId,
          outcomeStatus: 'CONFIRMED',
          correlationDecision: correlation,
        };
      }

      // Passo 10: Se AMBIGUOUS ou NOT_OBSERVED, classificar como UNKNOWN (ou NEEDS_REVIEW) sem repetir clique!
      this.deps.ledger.markUnknownOnPostDispatchFailure({
        submissionIntentId: intent.submissionIntentId,
        reason: `Correlacao pos-envio retornou ${correlation.status} (${correlation.ruleApplied})`,
        controllerEpoch: ctxPreClick.controllerEpoch,
        policyVersion: this.deps.policyVersion,
        registryVersion: this.deps.registryVersion,
      });

      if (correlation.requiresOperatorReview) {
        this.deps.ledger.updateJobState(jobId, 'SUBMITTING', 'NEEDS_REVIEW', 'UNKNOWN_STATE');
      }

      return {
        job: this.deps.ledger.getJobById(jobId),
        submissionIntentId: intent.submissionIntentId,
        outcomeStatus:
          correlation.status === 'AMBIGUOUS' ? 'UNKNOWN_AMBIGUOUS' : 'UNKNOWN_NOT_OBSERVED',
        correlationDecision: correlation,
      };
    } catch (obsErr) {
      this.deps.ledger.markUnknownOnPostDispatchFailure({
        submissionIntentId: intent.submissionIntentId,
        reason: `Erro ao observar resultados pos-envio: ${obsErr instanceof Error ? obsErr.message : String(obsErr)}`,
        controllerEpoch: ctxPreClick.controllerEpoch,
        policyVersion: this.deps.policyVersion,
        registryVersion: this.deps.registryVersion,
      });
      return {
        job: this.deps.ledger.getJobById(jobId),
        submissionIntentId: intent.submissionIntentId,
        outcomeStatus: 'UNKNOWN_ERROR',
        correlationDecision: null,
      };
    }
  }
}
