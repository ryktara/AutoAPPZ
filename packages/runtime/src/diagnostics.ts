import type { runtime as contracts } from "@autoappz/contracts";

type RuntimeDiagnostic = contracts.RuntimeDiagnostic;
type Phase = contracts.Phase;

export type Extracted = Omit<RuntimeDiagnostic, "id" | "projectId" | "at">;

/**
 * Turns tool output lines into structured diagnostics for the Problems dock and the repair loop.
 * Parsers are deliberately small and covered by golden tests; unknown lines yield nothing.
 */
export function extractDiagnostic(phase: Phase, rawLine: string): Extracted | undefined {
  const line = rawLine.trim();
  if (line.length === 0) return undefined;

  // tsc: src/a.ts(3,5): error TS2322: Type ...   |  src/a.ts:3:5 - error TS2322: ...
  const tsc = /^(.+?)[(:](\d+)[,:](\d+)\)?:?(?:\s*-)?\s*error\s+(TS\d+):\s*(.+)$/.exec(line);
  if (tsc) {
    return {
      source: "tsc",
      phase,
      severity: "error",
      file: tsc[1],
      line: Number(tsc[2]),
      column: Number(tsc[3]),
      code: tsc[4],
      message: tsc[5] ?? line,
    };
  }

  // pnpm / npm install failures
  const pnpm = /(ERR_PNPM_[A-Z0-9_]+)\s*(.*)$/.exec(line);
  if (pnpm)
    return {
      source: "install",
      phase,
      severity: "error",
      code: pnpm[1],
      message: pnpm[2]?.trim() ? pnpm[2].trim() : (pnpm[1] ?? line),
    };
  if (line.startsWith("npm ERR!"))
    return { source: "install", phase, severity: "error", message: line.replace(/^npm ERR!\s*/, "") };
  if (/ERR_PNPM_IGNORED_BUILDS|Ignored build scripts/.test(line))
    return { source: "install", phase, severity: "warning", message: line };

  // vite / bundler
  const viteImport = /Failed to resolve import "([^"]+)" from "([^"]+)"/.exec(line);
  if (viteImport)
    return {
      source: "vite",
      phase,
      severity: "error",
      file: viteImport[2],
      message: `Failed to resolve import "${viteImport[1] ?? ""}"`,
    };
  const viteErr = /^\[vite\]\s*(?:Internal server error|error):?\s*(.+)$/i.exec(line);
  if (viteErr) return { source: "vite", phase, severity: "error", message: viteErr[1] ?? line };
  const transform = /^(?:\[plugin:[^\]]+\]\s*)?(.+?):(\d+):(\d+):\s*(?:ERROR|error):\s*(.+)$/.exec(line);
  if (transform)
    return {
      source: "vite",
      phase,
      severity: "error",
      file: transform[1],
      line: Number(transform[2]),
      column: Number(transform[3]),
      message: transform[4] ?? line,
    };

  // node / generic
  if (line.includes("EADDRINUSE"))
    return {
      source: "runtime",
      phase,
      severity: "error",
      code: "EADDRINUSE",
      message: "Port already in use",
    };
  const generic = /^(?:Uncaught\s+)?(SyntaxError|TypeError|ReferenceError|RangeError|Error):\s*(.+)$/.exec(
    line,
  );
  if (generic)
    return { source: "runtime", phase, severity: "error", code: generic[1], message: generic[2] ?? line };
  if (/^\s*(warning|warn)\b/i.test(line) && /deprecat/i.test(line)) return undefined;
  return undefined;
}
