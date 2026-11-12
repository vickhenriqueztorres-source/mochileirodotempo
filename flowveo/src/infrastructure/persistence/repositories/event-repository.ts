import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { FlowDatabase } from '../database.js';
import { Redactor } from '../../observability/redactor.js';

export type AuditEventType =
  | 'action.planned'
  | 'action.denied'
  | 'permit.claimed'
  | 'action.observed'
  | 'submission.unknown'
  | 'correlation.decided'
  | 'artifact.verified'
  | 'artifact.rejected'
  | 'controller.acquired'
  | 'controller.paused'
  | 'circuit.opened'
  | 'system.preflight';

export interface AuditEventInput {
  eventId?: string;
  eventType: AuditEventType;
  correlationId: string;
  jobId?: string | null;
  controllerEpoch: number;
  policyVersion: string;
  registryVersion: string;
  reason: string;
  payload?: Record<string, unknown>;
}

export interface StoredAuditEvent {
  eventId: string;
  eventType: AuditEventType;
  correlationId: string;
  jobId: string | null;
  controllerEpoch: number;
  policyVersion: string;
  registryVersion: string;
  reason: string;
  payloadSanitizedJson: string;
  createdAt: string;
}

export class EventRepository {
  private readonly flowDb: FlowDatabase;
  private readonly redactor: Redactor;

  constructor(flowDb: FlowDatabase, redactor: Redactor) {
    this.flowDb = flowDb;
    this.redactor = redactor;
  }

  /**
   * Insere um evento dentro de uma transacao existente (para atomicidade estado + evento).
   * Se a sanitizacao falhar, lanca SanitizationFailureError antes de gravar qualquer byte (S-07).
   */
  public insertWithinTransaction(db: DatabaseSync, input: AuditEventInput): StoredAuditEvent {
    const sanitizedJson = this.redactor.sanitizeToJson(input.payload ?? {});
    const eventId = input.eventId ?? `evt_${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO events (
        event_id, event_type, correlation_id, job_id,
        controller_epoch, policy_version, registry_version,
        reason, payload_sanitized_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      eventId,
      input.eventType,
      input.correlationId,
      input.jobId ?? null,
      input.controllerEpoch,
      input.policyVersion,
      input.registryVersion,
      this.redactor.sanitizeString(input.reason),
      sanitizedJson,
      createdAt
    );

    return {
      eventId,
      eventType: input.eventType,
      correlationId: input.correlationId,
      jobId: input.jobId ?? null,
      controllerEpoch: input.controllerEpoch,
      policyVersion: input.policyVersion,
      registryVersion: input.registryVersion,
      reason: this.redactor.sanitizeString(input.reason),
      payloadSanitizedJson: sanitizedJson,
      createdAt,
    };
  }

  public recordStandaloneEvent(input: AuditEventInput): StoredAuditEvent {
    // Sanitizar ANTES de abrir transacao: se falhar, descarta evidencia sem tocar no banco
    const sanitizedJson = this.redactor.sanitizeToJson(input.payload ?? {});
    const sanitizedReason = this.redactor.sanitizeString(input.reason);
    const eventId = input.eventId ?? `evt_${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();

    return this.flowDb.writeTransaction((db) => {
      db.prepare(
        `INSERT INTO events (
          event_id, event_type, correlation_id, job_id,
          controller_epoch, policy_version, registry_version,
          reason, payload_sanitized_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        eventId,
        input.eventType,
        input.correlationId,
        input.jobId ?? null,
        input.controllerEpoch,
        input.policyVersion,
        input.registryVersion,
        sanitizedReason,
        sanitizedJson,
        createdAt
      );

      return {
        eventId,
        eventType: input.eventType,
        correlationId: input.correlationId,
        jobId: input.jobId ?? null,
        controllerEpoch: input.controllerEpoch,
        policyVersion: input.policyVersion,
        registryVersion: input.registryVersion,
        reason: sanitizedReason,
        payloadSanitizedJson: sanitizedJson,
        createdAt,
      };
    });
  }

  public listEvents(filter?: { jobId?: string; eventType?: AuditEventType }): StoredAuditEvent[] {
    return this.flowDb.read((db) => {
      let query = `SELECT
        event_id as eventId,
        event_type as eventType,
        correlation_id as correlationId,
        job_id as jobId,
        controller_epoch as controllerEpoch,
        policy_version as policyVersion,
        registry_version as registryVersion,
        reason,
        payload_sanitized_json as payloadSanitizedJson,
        created_at as createdAt
      FROM events WHERE 1=1`;
      const params: Array<string> = [];
      if (filter?.jobId) {
        query += ' AND job_id = ?';
        params.push(filter.jobId);
      }
      if (filter?.eventType) {
        query += ' AND event_type = ?';
        params.push(filter.eventType);
      }
      query += ' ORDER BY rowid ASC';
      return db.prepare(query).all(...params) as unknown as StoredAuditEvent[];
    });
  }
}
