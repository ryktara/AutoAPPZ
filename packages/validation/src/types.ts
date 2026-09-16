export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  readonly validator: string;
  readonly severity: DiagnosticSeverity;
  readonly code?: string | undefined;
  readonly message: string;
  /** Project-relative, forward slashes. */
  readonly file?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
}

export type ValidationStatus = "passed" | "failed" | "skipped" | "error";

export interface ValidationResult {
  readonly validator: string;
  readonly status: ValidationStatus;
  readonly diagnostics: readonly Diagnostic[];
  readonly durationMs: number;
  /** Diagnostics were capped. */
  readonly truncated: boolean;
  /** Why it was skipped, or the tool failure when `status` is "error". */
  readonly note?: string | undefined;
}

export interface ValidationReport {
  readonly attempt: number;
  /** No validator reported "failed". Tool errors are surfaced but do not block. */
  readonly ok: boolean;
  readonly results: readonly ValidationResult[];
  readonly diagnostics: readonly Diagnostic[];
  readonly durationMs: number;
  readonly startedAt: number;
}

export interface ValidatorContext {
  readonly projectRoot: string;
  /** Project-relative paths changed by the task (or dirty in the tree for on-demand runs). */
  readonly changedPaths: readonly string[];
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  /** Extra PATH entries / variables for tool resolution (tests inject the monorepo bin dir). */
  readonly env?: NodeJS.ProcessEnv | undefined;
}

export type Applicability = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Cost tiers: 0 = milliseconds (syntax), 1 = seconds (typecheck, lint), 2 = affected tests, 3 = full build. */
export type ValidatorTier = 0 | 1 | 2 | 3;

export interface Validator {
  readonly id: string;
  readonly tier: ValidatorTier;
  applies(ctx: ValidatorContext): Promise<Applicability>;
  run(ctx: ValidatorContext): Promise<ValidationResult>;
}

export const MAX_DIAGNOSTICS_PER_VALIDATOR = 200;
