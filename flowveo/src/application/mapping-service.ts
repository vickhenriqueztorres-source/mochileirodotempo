import type { FlowReader } from '../flow/contracts.js';
import {
  PassiveDiscovery,
  type PassiveDiscoveryReport,
  type RawControlObservation,
} from '../mapping/passive-discovery.js';
import {
  RegistryValidator,
  type RegistryValidationSummary,
} from '../mapping/registry-validator.js';
import {
  SupervisedBootstrap,
  type BootstrapProposal,
  type BootstrapResult,
} from '../mapping/supervised-bootstrap.js';
import {
  TransitionValidator,
  type ExploreStepInput,
  type ExploreStepResult,
} from '../mapping/transition-validator.js';

export class MappingService {
  private readonly flowReader: FlowReader;
  private readonly passiveDiscovery: PassiveDiscovery;
  private readonly supervisedBootstrap: SupervisedBootstrap;
  private readonly transitionValidator: TransitionValidator;
  private readonly registryValidator: RegistryValidator;
  private readonly inspectControlsFn: () => ReadonlyArray<RawControlObservation>;

  constructor(params: {
    flowReader: FlowReader;
    passiveDiscovery: PassiveDiscovery;
    supervisedBootstrap: SupervisedBootstrap;
    transitionValidator: TransitionValidator;
    registryValidator: RegistryValidator;
    inspectControlsFn: () => ReadonlyArray<RawControlObservation>;
  }) {
    this.flowReader = params.flowReader;
    this.passiveDiscovery = params.passiveDiscovery;
    this.supervisedBootstrap = params.supervisedBootstrap;
    this.transitionValidator = params.transitionValidator;
    this.registryValidator = params.registryValidator;
    this.inspectControlsFn = params.inspectControlsFn;
  }

  public async observe(pageState: string, policyVersion: string): Promise<PassiveDiscoveryReport> {
    const context = await this.flowReader.inspectContext();
    const rawControls = this.inspectControlsFn();
    return this.passiveDiscovery.observeAndRegisterCandidates({
      context,
      pageState,
      rawControls,
      policyVersion,
    });
  }

  public async bootstrap(proposal: BootstrapProposal): Promise<BootstrapResult> {
    const context = await this.flowReader.inspectContext();
    return this.supervisedBootstrap.approveAndExecuteBootstrapTransition(proposal, context);
  }

  public async explore(step: ExploreStepInput): Promise<ExploreStepResult> {
    const context = await this.flowReader.inspectContext();
    return this.transitionValidator.executeAuthorizedExploreStep(step, context);
  }

  public async validate(
    registryVersion: string,
    policyVersion: string
  ): Promise<RegistryValidationSummary> {
    const currentContext = await this.flowReader.inspectContext();
    const liveControls = this.inspectControlsFn();
    return this.registryValidator.validateRegistryContext({
      registryVersion,
      currentContext,
      liveControls,
      policyVersion,
    });
  }
}
