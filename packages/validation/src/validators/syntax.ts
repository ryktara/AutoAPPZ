import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { tryProjectRequire } from "../exec.ts";
import type { Diagnostic, ValidationResult, Validator } from "../types.ts";

const SCRIPT = /\.(m|c)?[jt]sx?$/;
const JSON_FILE = /\.jsonc?$/;

/** Minimal surface of the TypeScript compiler API this validator uses (loaded from the project). */
interface TsLike {
  transpileModule(
    input: string,
    options: { reportDiagnostics: boolean; fileName: string; compilerOptions: Record<string, unknown> },
  ): {
    diagnostics?: {
      messageText: unknown;
      start?: number;
      file?: { getLineAndCharacterOfPosition(pos: number): { line: number; character: number } };
    }[];
  };
  flattenDiagnosticMessageText(text: unknown, newline: string): string;
  JsxEmit: { Preserve: number };
}

/**
 * Tier 0: catches syntax errors in changed files in milliseconds. Uses the project's own `typescript`
 * (transpile-only diagnostics) when present, else a bracket-balance heuristic; JSON is parsed.
 */
export const syntaxValidator: Validator = {
  id: "syntax",
  tier: 0,
  applies(ctx) {
    const files = ctx.changedPaths.filter((p) => SCRIPT.test(p) || JSON_FILE.test(p));
    return Promise.resolve(
      files.length > 0 ? { ok: true } : { ok: false, reason: "no changed script or JSON files" },
    );
  },
  run(ctx): Promise<ValidationResult> {
    const started = Date.now();
    const ts = tryProjectRequire(ctx.projectRoot, "typescript") as TsLike | undefined;
    const diagnostics: Diagnostic[] = [];
    for (const rel of ctx.changedPaths) {
      const abs = path.join(ctx.projectRoot, rel);
      if (!existsSync(abs)) continue;
      let text: string;
      try {
        text = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      if (JSON_FILE.test(rel)) {
        try {
          JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
        } catch (error) {
          diagnostics.push(
            diag(rel, undefined, "JSON_PARSE", error instanceof Error ? error.message : String(error)),
          );
        }
        continue;
      }
      if (!SCRIPT.test(rel)) continue;
      if (ts) {
        const out = ts.transpileModule(text, {
          reportDiagnostics: true,
          fileName: abs,
          compilerOptions: { jsx: ts.JsxEmit.Preserve },
        });
        for (const d of out.diagnostics ?? []) {
          const pos =
            d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
          diagnostics.push(
            diag(
              rel,
              pos ? pos.line + 1 : undefined,
              "SYNTAX",
              ts.flattenDiagnosticMessageText(d.messageText, "\n"),
              pos ? pos.character + 1 : undefined,
            ),
          );
        }
      } else {
        const problem = bracketProblem(text);
        if (problem) diagnostics.push(diag(rel, problem.line, "SYNTAX", problem.message));
      }
    }
    return Promise.resolve({
      validator: "syntax",
      status: diagnostics.length === 0 ? "passed" : "failed",
      diagnostics,
      durationMs: Date.now() - started,
      truncated: false,
      note: ts ? undefined : "project typescript not installed; bracket check only",
    });
  },
};

function diag(
  file: string,
  line: number | undefined,
  code: string,
  message: string,
  column?: number,
): Diagnostic {
  return { validator: "syntax", severity: "error", code, message, file, line, column };
}

/** Bracket balance over code with strings, template literals and comments blanked out. */
export function bracketProblem(source: string): { line: number; message: string } | undefined {
  const cleaned = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "")
    .replace(/`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, (m) => m.replace(/[^\n]/g, " "));
  const stack: { ch: string; line: number }[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let line = 1;
  for (const ch of cleaned) {
    if (ch === "\n") line += 1;
    else if (ch === "(" || ch === "[" || ch === "{") stack.push({ ch, line });
    else if (ch === ")" || ch === "]" || ch === "}") {
      const open = stack.pop();
      if (!open || open.ch !== pairs[ch]) return { line, message: `Unexpected '${ch}'` };
    }
  }
  const dangling = stack.pop();
  return dangling ? { line: dangling.line, message: `Unclosed '${dangling.ch}'` } : undefined;
}
