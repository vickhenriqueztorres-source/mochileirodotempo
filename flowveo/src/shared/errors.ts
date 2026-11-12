export class FlowAutomationError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'FlowAutomationError';
    this.code = code;
    this.details = details;
  }
}

export class ConfigValidationError extends FlowAutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFIG_VALIDATION_ERROR', message, details);
    this.name = 'ConfigValidationError';
  }
}

export class PersistenceFailureError extends FlowAutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('PERSISTENCE_FAILURE_ERROR', message, details);
    this.name = 'PersistenceFailureError';
  }
}

export class MutationBlockedError extends FlowAutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('MUTATION_BLOCKED_ERROR', message, details);
    this.name = 'MutationBlockedError';
  }
}

export class SanitizationFailureError extends FlowAutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('SANITIZATION_FAILURE_ERROR', message, details);
    this.name = 'SanitizationFailureError';
  }
}

export class PolicyDeniedError extends FlowAutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('POLICY_DENIED_ERROR', message, details);
    this.name = 'PolicyDeniedError';
  }
}

export class PermitInvalidError extends FlowAutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('PERMIT_INVALID_ERROR', message, details);
    this.name = 'PermitInvalidError';
  }
}

export class ControllerBusyError extends FlowAutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONTROLLER_BUSY_ERROR', message, details);
    this.name = 'ControllerBusyError';
  }
}
