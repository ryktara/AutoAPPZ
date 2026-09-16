/**
 * Redaction is applied to every log line, error message and diagnostic bundle.
 * Two layers: (1) known secret values registered at runtime, (2) shape-based patterns.
 */

const PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI-style keys
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g, // Google API keys
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi,
  /(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/([^:\s/]+):([^@\s/]+)@/gi, // connection strings
  /((?:api[_-]?key|token|secret|password|passwd|pwd|authorization)\s*[=:]\s*["']?)([^\s"'&,;]{6,})/gi,
];

export const REDACTED = "[REDACTED]";

export class Redactor {
  private readonly values = new Set<string>();

  /** Register a literal secret value (minimum 6 chars to avoid destroying ordinary text). */
  register(value: string): void {
    if (value.length >= 6) this.values.add(value);
  }

  unregister(value: string): void {
    this.values.delete(value);
  }

  redactString(input: string): string {
    let out = input;
    for (const v of this.values) out = out.split(v).join(REDACTED);
    for (const p of PATTERNS) {
      out = out.replace(p, (match, ...groups: unknown[]) => {
        // Connection strings keep scheme and host; only the credentials are redacted.
        if (p.source.startsWith("(postgres")) return match.replace(/:\/\/[^@]+@/, `://${REDACTED}@`);
        const first = groups[0];
        // Patterns with a leading capture keep the prefix ("Bearer ", "api_key=") and redact the rest.
        if (typeof first === "string" && match.startsWith(first) && p.source.startsWith("("))
          return `${first}${REDACTED}`;
        return REDACTED;
      });
    }
    return out;
  }

  /** Deep-redacts strings inside any JSON-like value. Preserves structure; never throws. */
  redact<T>(value: T, depth = 0): T {
    if (depth > 20) return REDACTED as unknown as T;
    if (typeof value === "string") return this.redactString(value) as unknown as T;
    if (Array.isArray(value)) return value.map((v: unknown) => this.redact(v, depth + 1)) as unknown as T;
    if (value instanceof Error) {
      return {
        name: value.name,
        message: this.redactString(value.message),
        stack: value.stack ? this.redactString(value.stack) : undefined,
      } as unknown as T;
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = SENSITIVE_KEYS.test(k) && typeof v === "string" ? REDACTED : this.redact(v, depth + 1);
      }
      return out as T;
    }
    return value;
  }
}

const SENSITIVE_KEYS =
  /^(apiKey|api_key|token|accessToken|refreshToken|secret|password|passwd|authorization|cookie|set-cookie)$/i;
