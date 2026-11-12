import type {
  ContextSnapshot,
  CreationSnapshot,
  FlowReader,
  ResultObservation,
} from './contracts.js';

export interface FlowReaderDriverPort {
  readLiveContextAndConfig(): Promise<{
    context: ContextSnapshot;
    creation: CreationSnapshot;
  }>;
  inspectResultsPassively(): {
    isVirtualizedOrPartial: boolean;
    items: ResultObservation[];
  };
}

export interface FlowReaderOptions {
  maxReadRetries: number;
  baseBackoffMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * FlowReader auditavel (Arquitetura §5, §9, §20):
 * - Nunca expoe Page, Locator ou BrowserContext.
 * - Nao aceita nem executa JavaScript arbitrario recebido de chamadores.
 * - Aplica retry limitado com backoff e jitter para leituras transitorias (Arquitetura §20).
 */
export class DefaultFlowReader implements FlowReader {
  private readonly driverPort: FlowReaderDriverPort;
  private readonly maxReadRetries: number;
  private readonly baseBackoffMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(driverPort: FlowReaderDriverPort, options: FlowReaderOptions) {
    this.driverPort = driverPort;
    this.maxReadRetries = options.maxReadRetries;
    this.baseBackoffMs = options.baseBackoffMs ?? 15;
    this.sleepFn = options.sleepFn ?? defaultSleep;
  }

  private async withReadRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let lastError: unknown;
    while (attempt <= this.maxReadRetries) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt >= this.maxReadRetries) {
          break;
        }
        const jitter = Math.floor(Math.random() * 5);
        const delayMs = this.baseBackoffMs * Math.pow(2, attempt) + jitter;
        await this.sleepFn(delayMs);
        attempt += 1;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Falha apos ${this.maxReadRetries} retries de leitura: ${String(lastError)}`);
  }

  public async inspectContext(): Promise<ContextSnapshot> {
    return this.withReadRetry(async () => {
      const { context } = await this.driverPort.readLiveContextAndConfig();
      return structuredClone(context);
    });
  }

  public async inspectCreationForm(): Promise<CreationSnapshot> {
    return this.withReadRetry(async () => {
      const { creation } = await this.driverPort.readLiveContextAndConfig();
      return structuredClone(creation);
    });
  }

  public async inspectResults(): Promise<{
    isVirtualizedOrPartial: boolean;
    items: ResultObservation[];
  }> {
    return this.withReadRetry(async () => {
      const res = this.driverPort.inspectResultsPassively();
      return structuredClone(res);
    });
  }
}
