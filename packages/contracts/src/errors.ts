import { z } from "zod";

/** Classification of failures crossing any boundary. Drives retry policy, UI and telemetry filtering. */
export const AppErrorKindSchema = z.enum([
  "validation",
  "not_found",
  "permission",
  "conflict",
  "precondition",
  "cancelled",
  "timeout",
  "external",
  "internal",
]);
export type AppErrorKind = z.infer<typeof AppErrorKindSchema>;

export const SerializedAppErrorSchema = z.object({
  kind: AppErrorKindSchema,
  code: z.string().min(1),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  retryable: z.boolean(),
  correlationId: z.string().optional(),
});
export type SerializedAppError = z.infer<typeof SerializedAppErrorSchema>;

const RETRYABLE_BY_DEFAULT: ReadonlySet<AppErrorKind> = new Set(["timeout", "external"]);

export interface AppErrorOptions {
  details?: Record<string, unknown> | undefined;
  retryable?: boolean | undefined;
  correlationId?: string | undefined;
  cause?: unknown;
}

export class AppError extends Error {
  override readonly name = "AppError";
  readonly kind: AppErrorKind;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  readonly retryable: boolean;
  readonly correlationId: string | undefined;

  constructor(kind: AppErrorKind, code: string, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.kind = kind;
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? RETRYABLE_BY_DEFAULT.has(kind);
    this.correlationId = options.correlationId;
  }

  toJSON(): SerializedAppError {
    const out: SerializedAppError = {
      kind: this.kind,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.details !== undefined) out.details = this.details;
    if (this.correlationId !== undefined) out.correlationId = this.correlationId;
    return out;
  }

  static from(
    error: unknown,
    fallback: { kind?: AppErrorKind; code?: string; correlationId?: string } = {},
  ): AppError {
    if (error instanceof AppError) return error;
    if (error instanceof Error && error.name === "AbortError") {
      return new AppError("cancelled", "cancelled", "The operation was cancelled.", {
        correlationId: fallback.correlationId,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    return new AppError(fallback.kind ?? "internal", fallback.code ?? "unexpected", message, {
      cause: error,
      correlationId: fallback.correlationId,
    });
  }

  static fromSerialized(data: SerializedAppError): AppError {
    return new AppError(data.kind, data.code, data.message, {
      details: data.details,
      retryable: data.retryable,
      correlationId: data.correlationId,
    });
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
