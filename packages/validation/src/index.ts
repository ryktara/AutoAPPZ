export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  readonly validator: string;
  readonly severity: DiagnosticSeverity;
  readonly code: string | undefined;
  readonly message: string;
  readonly file: string | undefined; // project-relative
  readonly line: number | undefined;
  readonly column: number | undefined;
}

export interface ValidationResult {
  readonly validator: string;
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly durationMs: number;
  readonly truncated: boolean;
}

export interface Validator {
  readonly id: string;
  /** True when the project has what this validator needs (config file, dependency). */
  applies(projectRoot: string): Promise<boolean>;
  run(projectRoot: string, signal: AbortSignal): Promise<ValidationResult>;
}
