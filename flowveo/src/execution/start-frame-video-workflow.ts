import crypto from 'node:crypto';
import type { ActionPlan } from '../domain/actions/action-types.js';
import type { ArtifactChainLink, ArtifactRecord } from '../domain/artifacts/artifact-types.js';
import {
  buildFlowMotionPromptFromStartFrame,
  type BuiltFlowMotionPrompt,
} from '../domain/media/flow-motion-prompt.js';
import {
  StartFrameValidator,
  type ValidatedStartFrame,
} from '../domain/media/start-frame-validator.js';
import type { AuthorizedExecutor, FlowReader, SafetyGateway } from '../flow/contracts.js';
import { ArtifactStore } from '../infrastructure/artifacts/artifact-store.js';
import { DownloadVerifier } from '../infrastructure/artifacts/download-verifier.js';
import { sha256Hex } from '../infrastructure/observability/redactor.js';
import { PolicyDeniedError } from '../shared/errors.js';
import { SubmissionLedger } from './submission-ledger.js';

export interface StartFrameVideoJobSpec {
  jobId: string;
  projectContextId: string;
  accountContextId: string;
  startFrameRelativePath: string;
  rawMotionPrompt: string;
  povAction?: string;
  ptBrDialogue?: string;
  targetVideoModel: string;
  aspectRatio: '16:9' | '9:16';
  requestedOutputs: 1 | 2 | 3 | 4;
}

export interface StartFramePrepareResult {
  jobId: string;
  status: 'PREPARED';
  validatedStartFrame: ValidatedStartFrame;
  builtPrompt: BuiltFlowMotionPrompt;
  observedConfigDigest: string;
  selectedModel: string;
  selectedAspectRatio: string;
  selectedOutputsCount: number;
  uploadReadyFilename: string;
  submissionsTriggered: 0;
}

export interface StartFrameRunAndDownloadResult {
  jobId: string;
  status: 'COMPLETED';
  prepareResult: StartFramePrepareResult;
  submissionIntentId: string;
  remoteSubmissionId: string;
  remoteExternalId: string;
  artifact: ArtifactRecord;
  chainLink: ArtifactChainLink;
}

/**
 * Orquestrador Start Frame -> Video no Google Flow (Subetapas SF-1 a SF-6 — Estilo Firefly):
 * 1. Valida Start Frame inedito (magic bytes, resolucao 16:9/9:16, SHA-256 unico).
 * 2. Troca o composer de Imagem ('Nano Banana') para Video ('Veo') + proporcao + x1.
 * 3. Anexa o Start Frame no botao '+' (ctrl_add_media) e exige comprovacao de uploadReadyFilename.
 * 4. Preenche o prompt de movimento POV com ancora de continuidade e comprova digest.
 * 5. No modo 'prepare', para antes do SUBMIT com 0 envios.
 * 6. No modo 'execute', revalida o digest pre-submit, reserva quota via SubmissionLedger, submete,
 *    confirma o resultado e baixa o .mp4 auditado via ArtifactStore + DownloadVerifier.
 */
export class StartFrameVideoWorkflow {
  private readonly reader: FlowReader;
  private readonly safetyGateway: SafetyGateway;
  private readonly executor: AuthorizedExecutor;
  private readonly startFrameValidator: StartFrameValidator;
  private readonly ledger: SubmissionLedger;
  private readonly artifactStore: ArtifactStore;
  private readonly verifier: DownloadVerifier;
  private readonly registryVersion: string;
  private readonly policyVersion: string;

  constructor(params: {
    reader: FlowReader;
    safetyGateway: SafetyGateway;
    executor: AuthorizedExecutor;
    startFrameValidator: StartFrameValidator;
    ledger: SubmissionLedger;
    artifactStore: ArtifactStore;
    verifier: DownloadVerifier;
    registryVersion: string;
    policyVersion: string;
  }) {
    this.reader = params.reader;
    this.safetyGateway = params.safetyGateway;
    this.executor = params.executor;
    this.startFrameValidator = params.startFrameValidator;
    this.ledger = params.ledger;
    this.artifactStore = params.artifactStore;
    this.verifier = params.verifier;
    this.registryVersion = params.registryVersion;
    this.policyVersion = params.policyVersion;
  }

  public async prepareStartFrameVideo(
    spec: StartFrameVideoJobSpec
  ): Promise<StartFramePrepareResult> {
    // SF-1: Validar Start Frame fisico e construir Prompt POV com ancora de continuidade
    if (spec.targetVideoModel.toLowerCase().includes('nano banana')) {
      throw new PolicyDeniedError(
        `Modelo '${spec.targetVideoModel}' e um modelo de imagem. Geracao de video com Start Frame exige motor de video (ex: Veo 2 / Veo 3.1).`
      );
    }

    const validatedStartFrame = this.startFrameValidator.validateStartFrame({
      relativeOrFilePath: spec.startFrameRelativePath,
      expectedAspectRatio: spec.aspectRatio,
      enforceUniqueSha256: true,
    });

    const builtPrompt = buildFlowMotionPromptFromStartFrame({
      rawMotionPrompt: spec.rawMotionPrompt,
      povAction: spec.povAction,
      ptBrDialogue: spec.ptBrDialogue,
    });

    // SF-2: Trocar composer para Modo Video (Veo) + Proporcao + Quantidade
    const ctx1 = await this.reader.inspectContext();
    const form1 = await this.reader.inspectCreationForm();
    const configParams = {
      model: spec.targetVideoModel,
      aspectRatio: spec.aspectRatio,
      outputsCount: spec.requestedOutputs,
    };
    const configPlan: ActionPlan = {
      planId: `plan_sf_cfg_${crypto.randomUUID()}`,
      jobId: spec.jobId,
      mode: 'prepare',
      actionKind: 'CONFIGURE',
      targetControlId: 'ctrl_model_selector',
      transitionId: 'tr_configure_video_mode',
      paramsCanonical: configParams,
      paramsDigestSha256: sha256Hex(JSON.stringify(configParams)),
      projectContextId: spec.projectContextId,
      accountContextId: spec.accountContextId,
      registryVersion: this.registryVersion,
      policyVersion: this.policyVersion,
      observedConfigDigest: form1.observedConfigDigest,
      observedRevision: ctx1.observedRevision,
    };

    const decCfg = await this.safetyGateway.authorize(configPlan, ctx1);
    if (!decCfg.allowed) {
      throw new PolicyDeniedError(`Falha ao autorizar CONFIGURE de modo video: ${decCfg.reason}`);
    }
    const outCfg = await this.executor.execute(decCfg.permit.permitId);
    if (!outCfg.postconditionVerified || outCfg.status !== 'SUCCESS') {
      throw new PolicyDeniedError('Pos-condicao de troca para Modo Video (Veo) falhou (SF-2).');
    }

    // SF-3: Fazer Upload do Start Frame no botao '+' (ctrl_add_media)
    const ctx2 = await this.reader.inspectContext();
    const form2 = await this.reader.inspectCreationForm();
    const uploadParams = {
      filename: validatedStartFrame.filename,
      startFrameSha256: validatedStartFrame.sha256,
      aspectRatio: validatedStartFrame.aspectRatio,
    };
    const uploadPlan: ActionPlan = {
      planId: `plan_sf_upl_${crypto.randomUUID()}`,
      jobId: spec.jobId,
      mode: 'prepare',
      actionKind: 'UPLOAD',
      targetControlId: 'ctrl_add_media',
      transitionId: 'tr_upload_start_frame',
      paramsCanonical: uploadParams,
      paramsDigestSha256: sha256Hex(JSON.stringify(uploadParams)),
      projectContextId: spec.projectContextId,
      accountContextId: spec.accountContextId,
      registryVersion: this.registryVersion,
      policyVersion: this.policyVersion,
      observedConfigDigest: form2.observedConfigDigest,
      observedRevision: ctx2.observedRevision,
    };

    const decUpl = await this.safetyGateway.authorize(uploadPlan, ctx2);
    if (!decUpl.allowed) {
      throw new PolicyDeniedError(`Falha ao autorizar UPLOAD do Start Frame: ${decUpl.reason}`);
    }
    const outUpl = await this.executor.execute(decUpl.permit.permitId);
    if (!outUpl.postconditionVerified || outUpl.status !== 'SUCCESS') {
      throw new PolicyDeniedError('Pos-condicao de upload do Start Frame falhou (SF-3).');
    }

    // SF-4: Preencher Prompt de Movimento POV e verificar estabilizacao
    const ctx3 = await this.reader.inspectContext();
    const form3 = await this.reader.inspectCreationForm();
    const fillParams = {
      promptText: builtPrompt.promptText,
      promptDigestSha256: builtPrompt.promptDigestSha256,
    };
    const fillPlan: ActionPlan = {
      planId: `plan_sf_fill_${crypto.randomUUID()}`,
      jobId: spec.jobId,
      mode: 'prepare',
      actionKind: 'FILL',
      targetControlId: 'ctrl_prompt_input',
      transitionId: 'tr_fill_motion_prompt',
      paramsCanonical: fillParams,
      paramsDigestSha256: sha256Hex(JSON.stringify(fillParams)),
      projectContextId: spec.projectContextId,
      accountContextId: spec.accountContextId,
      registryVersion: this.registryVersion,
      policyVersion: this.policyVersion,
      observedConfigDigest: form3.observedConfigDigest,
      observedRevision: ctx3.observedRevision,
    };

    const decFill = await this.safetyGateway.authorize(fillPlan, ctx3);
    if (!decFill.allowed) {
      throw new PolicyDeniedError(`Falha ao autorizar FILL do prompt POV: ${decFill.reason}`);
    }
    const outFill = await this.executor.execute(decFill.permit.permitId);
    if (!outFill.postconditionVerified || outFill.status !== 'SUCCESS') {
      throw new PolicyDeniedError(
        'Pos-condicao do prompt de movimento POV falhou apos estabilizacao (SF-4).'
      );
    }

    const finalForm = await this.reader.inspectCreationForm();
    if (
      finalForm.uploadReadyFilename !== validatedStartFrame.filename ||
      finalForm.promptDigestSha256 !== builtPrompt.promptDigestSha256 ||
      finalForm.selectedModel !== spec.targetVideoModel
    ) {
      throw new PolicyDeniedError(
        'Inconsistencia detectada no CreationSnapshot ao final do prepare.'
      );
    }

    return {
      jobId: spec.jobId,
      status: 'PREPARED',
      validatedStartFrame,
      builtPrompt,
      observedConfigDigest: finalForm.observedConfigDigest,
      selectedModel: finalForm.selectedModel,
      selectedAspectRatio: finalForm.selectedAspectRatio,
      selectedOutputsCount: finalForm.selectedOutputsCount,
      uploadReadyFilename: finalForm.uploadReadyFilename,
      submissionsTriggered: 0,
    };
  }

  public async runAndDownloadStartFrameVideo(params: {
    spec: StartFrameVideoJobSpec;
    videoPayloadBytes: Buffer;
  }): Promise<StartFrameRunAndDownloadResult> {
    const prepareResult = await this.prepareStartFrameVideo(params.spec);

    // SF-5: Barreira Pre-Submit — revalidar que Start Frame, Modelo Video e Prompt continuam intactos
    const preSubmitCtx = await this.reader.inspectContext();
    const preSubmitForm = await this.reader.inspectCreationForm();

    if (
      preSubmitForm.observedConfigDigest !== prepareResult.observedConfigDigest ||
      preSubmitForm.uploadReadyFilename !== prepareResult.validatedStartFrame.filename ||
      preSubmitForm.promptDigestSha256 !== prepareResult.builtPrompt.promptDigestSha256 ||
      preSubmitForm.selectedModel.toLowerCase().includes('nano banana')
    ) {
      throw new PolicyDeniedError(
        'Barreira Pre-Submit bloqueou o envio: Start Frame, modelo de video ou prompt divergiram antes do clique (SF-5).'
      );
    }

    const job = this.ledger.createJob({
      jobId: params.spec.jobId,
      prompt: prepareResult.builtPrompt.promptText,
      model: params.spec.targetVideoModel,
      aspectRatio: params.spec.aspectRatio,
      requestedOutputs: params.spec.requestedOutputs,
      startFramePath: prepareResult.validatedStartFrame.filename,
      projectContextId: params.spec.projectContextId,
      accountContextId: params.spec.accountContextId,
      completionPolicy: {
        minVerifiedOutputs: 1,
        allowPartial: false,
        technicalRequirements: {
          minSizeBytes: 1024,
          expectedContainer: 'mp4',
        },
      },
    });

    const { intent } = this.ledger.createIntentAndReserveBudget({
      jobId: job.jobId,
      controllerEpoch: preSubmitCtx.controllerEpoch,
      observedConfigDigest: prepareResult.observedConfigDigest,
      baselineSnapshot: {
        startFrameSha256: prepareResult.validatedStartFrame.sha256,
        uploadReadyFilename: prepareResult.validatedStartFrame.filename,
      },
      policyVersion: this.policyVersion,
      registryVersion: this.registryVersion,
    });

    const submitParams = {
      submissionIntentId: intent.submissionIntentId,
      startFrameSha256: prepareResult.validatedStartFrame.sha256,
      promptDigestSha256: prepareResult.builtPrompt.promptDigestSha256,
    };
    const submitPlan: ActionPlan = {
      planId: `plan_sf_sub_${crypto.randomUUID()}`,
      jobId: job.jobId,
      submissionIntentId: intent.submissionIntentId,
      mode: 'execute',
      actionKind: 'SUBMIT',
      targetControlId: 'ctrl_submit',
      transitionId: 'tr_submit_video_generation',
      paramsCanonical: submitParams,
      paramsDigestSha256: sha256Hex(JSON.stringify(submitParams)),
      projectContextId: params.spec.projectContextId,
      accountContextId: params.spec.accountContextId,
      registryVersion: this.registryVersion,
      policyVersion: this.policyVersion,
      observedConfigDigest: preSubmitForm.observedConfigDigest,
      observedRevision: preSubmitCtx.observedRevision,
    };

    const decSub = await this.safetyGateway.authorize(submitPlan, preSubmitCtx);
    if (!decSub.allowed) {
      this.ledger.abortBeforeDispatch(
        intent.submissionIntentId,
        decSub.reason,
        preSubmitCtx.controllerEpoch
      );
      throw new PolicyDeniedError(`SUBMIT negado pelo SafetyGateway: ${decSub.reason}`);
    }

    this.ledger.markDispatchingBeforeClick(intent.submissionIntentId);
    const outSub = await this.executor.execute(decSub.permit.permitId);
    if (!outSub.postconditionVerified || outSub.status !== 'SUCCESS') {
      this.ledger.markUnknownOnPostDispatchFailure({
        submissionIntentId: intent.submissionIntentId,
        reason: 'Pos-condicao de SUBMIT falhou apos DISPATCHING',
        controllerEpoch: preSubmitCtx.controllerEpoch,
        policyVersion: this.policyVersion,
        registryVersion: this.registryVersion,
      });
      throw new PolicyDeniedError('Falha na pos-condicao de SUBMIT (SF-5).');
    }

    const remoteExternalId = String(outSub.details.remoteExternalId ?? `rem_sf_${Date.now()}`);
    const { remoteSubmission } = this.ledger.confirmSubmission({
      submissionIntentId: intent.submissionIntentId,
      scopeId: `scp_${params.spec.projectContextId}`,
      remoteExternalId,
      controllerEpoch: preSubmitCtx.controllerEpoch,
      policyVersion: this.policyVersion,
      registryVersion: this.registryVersion,
      ruleApplied: 'RULE_1_STABLE_ID',
    });

    const remoteResult = this.artifactStore.upsertRemoteResult({
      remoteSubmissionId: remoteSubmission.remoteSubmissionId,
      resultIndex: 0,
      remoteAssetId: `asset_${remoteExternalId}`,
      status: 'READY',
    });

    // SF-6: Solicitar permissao de DOWNLOAD, gravar em .part, renomear para .mp4 e verificar com DownloadVerifier
    const dlCtx = await this.reader.inspectContext();
    const dlForm = await this.reader.inspectCreationForm();
    const dlParams = { remoteResultId: remoteResult.remoteResultId };
    const dlPlan: ActionPlan = {
      planId: `plan_sf_dl_${crypto.randomUUID()}`,
      jobId: job.jobId,
      submissionIntentId: intent.submissionIntentId,
      mode: 'execute',
      actionKind: 'DOWNLOAD',
      targetControlId: `ctrl_dl_${remoteExternalId}`,
      transitionId: 'tr_download_start_frame_video',
      paramsCanonical: dlParams,
      paramsDigestSha256: sha256Hex(JSON.stringify(dlParams)),
      projectContextId: params.spec.projectContextId,
      accountContextId: params.spec.accountContextId,
      registryVersion: this.registryVersion,
      policyVersion: this.policyVersion,
      observedConfigDigest: dlForm.observedConfigDigest,
      observedRevision: dlCtx.observedRevision,
    };

    const decDl = await this.safetyGateway.authorize(dlPlan, dlCtx);
    if (!decDl.allowed) {
      throw new PolicyDeniedError(`DOWNLOAD negado pelo SafetyGateway: ${decDl.reason}`);
    }

    const plannedArtifact = this.artifactStore.planArtifactDownload({
      jobId: job.jobId,
      submissionIntentId: intent.submissionIntentId,
      remoteSubmissionId: remoteSubmission.remoteSubmissionId,
      remoteResultId: remoteResult.remoteResultId,
      downloadPermitId: decDl.permit.permitId,
      remoteSuggestedFilename: `${params.spec.jobId}_start_frame_video.mp4`,
      expectedExtension: 'mp4',
    });

    this.artifactStore.writeStagingPart(plannedArtifact.artifactId, params.videoPayloadBytes);
    this.artifactStore.finalizeStagingToDownloaded(plannedArtifact.artifactId);

    const verifiedOutcome = await this.verifier.verifyDownloadedArtifact(
      plannedArtifact.artifactId,
      job.completionPolicy
    );

    if (verifiedOutcome.artifact.status !== 'VERIFIED' || !verifiedOutcome.chainLink) {
      throw new PolicyDeniedError(
        `Falha na verificacao tecnica do MP4 baixado: ${verifiedOutcome.artifact.rejectionReason ?? 'desconhecido'}`
      );
    }

    this.ledger.updateJobState(job.jobId, 'DONE', 'COMPLETED', null);

    return {
      jobId: job.jobId,
      status: 'COMPLETED',
      prepareResult,
      submissionIntentId: intent.submissionIntentId,
      remoteSubmissionId: remoteSubmission.remoteSubmissionId,
      remoteExternalId,
      artifact: verifiedOutcome.artifact,
      chainLink: verifiedOutcome.chainLink,
    };
  }
}
