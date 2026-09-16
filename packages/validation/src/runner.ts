import type { Logger } from "@autoappz/diagnostics";
import type { Diagnostic, ValidationReport, ValidationResult, Validator, ValidatorTier } from "./types.ts";
import { syntaxValidator } from "./validators/syntax.ts";
import { buildValidator, lintValidator, testsValidator, typecheckValidator } from "./validators/tools.ts";

export const DEFAULT_TIMEOUTS_MS: Record<ValidatorTier, number> = {
  0: 10_000,
  1: 120_000,
  2: 300_000,
  3: 600_000,
};

export function createDefaultValidators(): Validator[] {
  return [syntaxValidator, typecheckValidator, lintValidator, testsValidator, buildValidator];
}

export interface RunValidationInput {
  readonly projectRoot: string;
  readonly changedPaths: readonly string[];
  readonly signal: AbortSignal;
  /** Highest tier to run; more expensive validators are reported as skipped. */
  readonly maxTier: ValidatorTier;
  readonly attempt: number;
  readonly validators?: readonly Validator[] | undefined;
  readonly timeoutsMs?: Partial<Record<ValidatorTier, number>> | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => number) | undefined;
  /** Progress callback per finished validator (UI streaming). */
  readonly onResult?: ((result: ValidationResult) => void) | undefined;
}

/**
 * Runs validators in cost order. A failing tier ends the run (cheaper feedback for the repair loop);
 * inapplicable validators are reported as skipped with the reason so the UI can explain gaps.
 */
export async function runValidation(input: RunValidationInput): Promise<ValidationReport> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const started = Date.now();
  const validators = [...(input.validators ?? createDefaultValidators())].sort((a, b) => a.tier - b.tier);
  const results: ValidationResult[] = [];
  let failedTier: ValidatorTier | undefined;
  for (const v of validators) {
    const push = (r: ValidationResult) => {
      results.push(r);
      input.onResult?.(r);
    };
    if (v.tier > input.maxTier) {
      push({
        validator: v.id,
        status: "skipped",
        diagnostics: [],
        durationMs: 0,
        truncated: false,
        note: "not run for this task profile",
      });
      continue;
    }
    if (failedTier !== undefined && v.tier > failedTier) {
      push({
        validator: v.id,
        status: "skipped",
        diagnostics: [],
        durationMs: 0,
        truncated: false,
        note: `skipped: tier ${String(failedTier)} failed`,
      });
      continue;
    }
    if (input.signal.aborted) {
      push({
        validator: v.id,
        status: "skipped",
        diagnostics: [],
        durationMs: 0,
        truncated: false,
        note: "cancelled",
      });
      continue;
    }
    const ctx = {
      projectRoot: input.projectRoot,
      changedPaths: input.changedPaths,
      signal: input.signal,
      timeoutMs: input.timeoutsMs?.[v.tier] ?? DEFAULT_TIMEOUTS_MS[v.tier],
      env: input.env,
    };
    let r: ValidationResult;
    try {
      const applicable = await v.applies(ctx);
      if (!applicable.ok) {
        push({
          validator: v.id,
          status: "skipped",
          diagnostics: [],
          durationMs: 0,
          truncated: false,
          note: applicable.reason,
        });
        continue;
      }
      r = await v.run(ctx);
    } catch (error) {
      r = {
        validator: v.id,
        status: "error",
        diagnostics: [],
        durationMs: 0,
        truncated: false,
        note: error instanceof Error ? error.message : String(error),
      };
    }
    input.logger?.info("validator finished", {
      validator: v.id,
      status: r.status,
      diagnostics: r.diagnostics.length,
      ms: r.durationMs,
    });
    push(r);
    if (r.status === "failed") failedTier = v.tier;
  }
  const diagnostics: Diagnostic[] = results.flatMap((r) => r.diagnostics);
  return {
    attempt: input.attempt,
    ok: !results.some((r) => r.status === "failed"),
    results,
    diagnostics,
    durationMs: Date.now() - started,
    startedAt,
  };
}
