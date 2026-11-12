import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Redactor } from './redactor.js';
import { EventRepository, type AuditEventInput, type StoredAuditEvent } from '../persistence/repositories/event-repository.js';

export class StructuredLogger {
  private readonly redactor: Redactor;
  private readonly memorySink: string[] = [];

  constructor(redactor: Redactor) {
    this.redactor = redactor;
  }

  public info(message: string, context?: Record<string, unknown>): string {
    return this.write('INFO', message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): string {
    return this.write('WARN', message, context);
  }

  public error(message: string, context?: Record<string, unknown>): string {
    return this.write('ERROR', message, context);
  }

  private write(level: 'INFO' | 'WARN' | 'ERROR', message: string, context?: Record<string, unknown>): string {
    const cleanMsg = this.redactor.sanitizeString(message);
    const cleanCtx = context ? this.redactor.sanitize(context) : {};
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: cleanMsg,
      ctx: cleanCtx,
    });
    this.memorySink.push(entry);
    return entry;
  }

  public getLogs(): readonly string[] {
    return this.memorySink;
  }
}

export class EvidenceRecorder {
  private readonly redactor: Redactor;
  private readonly eventRepo: EventRepository;
  private readonly evidenceDir: string;

  constructor(redactor: Redactor, eventRepo: EventRepository, evidenceDir: string) {
    this.redactor = redactor;
    this.eventRepo = eventRepo;
    this.evidenceDir = evidenceDir;
    fs.mkdirSync(this.evidenceDir, { recursive: true });
  }

  /**
   * Persiste evidencia sanitizada no disco e registra evento duravel no SQLite.
   * Regra S-07 / Arquitetura §19: Se a sanitizacao falhar, descarta a evidencia e NAO salva arquivo bruto.
   */
  public recordEvidenceAndEvent(
    eventInput: AuditEventInput,
    rawEvidenceSnapshot?: Record<string, unknown>
  ): { event: StoredAuditEvent; evidenceFile?: string } {
    let evidenceFile: string | undefined;
    let payloadWithEvidence = { ...(eventInput.payload ?? {}) };

    if (rawEvidenceSnapshot !== undefined) {
      // Sanitiza primeiro em memoria; se lancar SanitizationFailureError, nenhum arquivo e criado
      const sanitizedEvidenceJson = this.redactor.sanitizeToJson(rawEvidenceSnapshot);
      const evidenceId = `evd_${crypto.randomUUID()}`;
      const filePath = path.join(this.evidenceDir, `${evidenceId}.json`);
      fs.writeFileSync(filePath, sanitizedEvidenceJson, { encoding: 'utf-8', mode: 0o600 });
      evidenceFile = filePath;
      payloadWithEvidence = {
        ...payloadWithEvidence,
        evidenceId,
      };
    }

    const event = this.eventRepo.recordStandaloneEvent({
      ...eventInput,
      payload: payloadWithEvidence,
    });

    return { event, evidenceFile };
  }
}
