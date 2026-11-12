import crypto from 'node:crypto';
import { SanitizationFailureError } from '../../shared/errors.js';

const SENSITIVE_KEY_PATTERNS = [
  /cookie/i,
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /authorization/i,
  /credential/i,
  /storagestate/i,
  /api[-_]?key/i,
  /session[-_]?id/i,
  /set-cookie/i,
];

const PERSONAL_CONTENT_KEYS = new Set(['prompt', 'rawPrompt', 'rawDom', 'domHtml']);

const SECRET_VALUE_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // Bearer tokens e Google OAuth tokens (ya29.*)
  { regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  { regex: /\bya29\.[A-Za-z0-9\-_]+/g, replacement: '[REDACTED_GOOGLE_OAUTH]' },
  // Cookies de sessao Google (SID, HSID, SSID, APISID, SAPISID, __Secure-*)
  {
    regex: /\b(__Secure-[A-Za-z0-9_]+|SID|HSID|SSID|APISID|SAPISID)=[^;\s"']+/gi,
    replacement: '$1=[REDACTED_COOKIE]',
  },
  // Query params sensiveis em URLs
  {
    regex: /([?&](?:token|access_token|id_token|api_key|key|secret|sig|signature|session)=)[^&#\s"']+/gi,
    replacement: '$1[REDACTED_PARAM]',
  },
  // JWTs
  {
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: '[REDACTED_JWT]',
  },
];

export function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

export function summarizeSensitiveText(text: string): {
  redacted: true;
  digestSha256: string;
  length: number;
} {
  return {
    redacted: true,
    digestSha256: sha256Hex(text),
    length: text.length,
  };
}

export interface RedactorOptions {
  failForTesting?: boolean;
  maxDepth?: number;
}

export class Redactor {
  private readonly maxDepth: number;
  private forceFail = false;

  constructor(options?: RedactorOptions) {
    this.maxDepth = options?.maxDepth ?? 12;
    this.forceFail = options?.failForTesting ?? false;
  }

  public setForceFailForTesting(fail: boolean): void {
    this.forceFail = fail;
  }

  /**
   * Sanitiza qualquer payload antes de logar ou persistir evidencia (Arquitetura §19 / S-07).
   * Se a sanitizacao falhar (ou encontrar referencia circular/profundidade excessiva),
   * lanca SanitizationFailureError para que o chamador DESCARTE a evidencia (nunca salva bruto).
   */
  public sanitize<T = unknown>(input: T): unknown {
    if (this.forceFail) {
      throw new SanitizationFailureError(
        'Falha de sanitizacao simulada — evidencia descartada por seguranca (S-07).'
      );
    }

    const seen = new WeakSet<object>();
    try {
      return this.sanitizeNode(input, 0, seen);
    } catch (err) {
      if (err instanceof SanitizationFailureError) {
        throw err;
      }
      throw new SanitizationFailureError(
        'Falha inesperada durante sanitizacao — evidencia descartada (S-07).',
        { error: err instanceof Error ? err.message : String(err) }
      );
    }
  }

  public sanitizeToJson(input: unknown): string {
    const clean = this.sanitize(input);
    return JSON.stringify(clean);
  }

  private sanitizeNode(node: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (depth > this.maxDepth) {
      throw new SanitizationFailureError('Profundidade maxima de sanitizacao excedida.');
    }

    if (node === null || node === undefined) {
      return node;
    }

    if (typeof node === 'string') {
      return this.sanitizeString(node);
    }

    if (typeof node === 'number' || typeof node === 'boolean') {
      return node;
    }

    if (typeof node === 'function' || typeof node === 'symbol') {
      throw new SanitizationFailureError('Tipo nao serializavel encontrado em evidencia.');
    }

    if (Array.isArray(node)) {
      return node.map((item) => this.sanitizeNode(item, depth + 1, seen));
    }

    if (typeof node === 'object') {
      if (seen.has(node)) {
        throw new SanitizationFailureError('Referencia circular detectada durante sanitizacao.');
      }
      seen.add(node);

      const output: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        // Acessar getter pode lancar erro
        if (SENSITIVE_KEY_PATTERNS.some((rx) => rx.test(key))) {
          output[key] = '[REDACTED_SECRET]';
          continue;
        }

        if (PERSONAL_CONTENT_KEYS.has(key) && typeof value === 'string') {
          output[key] = summarizeSensitiveText(value);
          continue;
        }

        output[key] = this.sanitizeNode(value, depth + 1, seen);
      }
      return output;
    }

    return String(node);
  }

  public sanitizeString(str: string): string {
    let result = str;
    for (const rule of SECRET_VALUE_PATTERNS) {
      result = result.replace(rule.regex, rule.replacement);
    }
    return result;
  }
}
