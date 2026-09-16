import { extractDiagnostic } from "@autoappz/runtime";
import { toProjectRelative } from "./exec.ts";
import { MAX_DIAGNOSTICS_PER_VALIDATOR, type Diagnostic } from "./types.ts";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** `src/a.ts(3,5): error TS2322: msg` and `src/a.ts:3:5 - error TS2322: msg`. */
export function parseTscOutput(projectRoot: string, output: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const re = /^(.+?)[(:](\d+)[,:](\d+)\)?:?(?:\s*-)?\s*(error|warning)\s+(TS\d+):\s*(.+)$/;
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.replace(ANSI, "").trim();
    const m = re.exec(line);
    if (!m) continue;
    out.push({
      validator: "typecheck",
      severity: m[4] === "warning" ? "warning" : "error",
      code: m[5],
      message: m[6] ?? line,
      file: toProjectRelative(projectRoot, m[1] ?? ""),
      line: Number(m[2]),
      column: Number(m[3]),
    });
    if (out.length >= MAX_DIAGNOSTICS_PER_VALIDATOR) break;
  }
  return out;
}

interface EslintFile {
  filePath: string;
  messages: { ruleId: string | null; severity: number; message: string; line?: number; column?: number }[];
}

/** ESLint `--format json`. Severity 2 → error, 1 → warning. */
export function parseEslintJson(projectRoot: string, json: string): Diagnostic[] {
  const start = json.indexOf("[");
  if (start < 0) return [];
  let files: EslintFile[];
  try {
    files = JSON.parse(json.slice(start)) as EslintFile[];
  } catch {
    return [];
  }
  const out: Diagnostic[] = [];
  for (const f of files) {
    for (const m of f.messages) {
      out.push({
        validator: "lint",
        severity: m.severity === 2 ? "error" : "warning",
        code: m.ruleId ?? undefined,
        message: m.message,
        file: toProjectRelative(projectRoot, f.filePath),
        line: m.line,
        column: m.column,
      });
      if (out.length >= MAX_DIAGNOSTICS_PER_VALIDATOR) return out;
    }
  }
  return out;
}

interface VitestJson {
  numTotalTests?: number;
  numFailedTests?: number;
  numPassedTests?: number;
  success?: boolean;
  testResults?: {
    name: string;
    status: string;
    message?: string;
    assertionResults?: { fullName: string; status: string; failureMessages?: string[] }[];
  }[];
}

export interface TestSummary {
  readonly total: number;
  readonly failed: number;
  readonly passed: number;
  readonly diagnostics: Diagnostic[];
}

/** Vitest `--reporter=json`. One diagnostic per failed test (first failure line) or per failed file. */
export function parseVitestJson(projectRoot: string, json: string): TestSummary | undefined {
  const start = json.indexOf("{");
  if (start < 0) return undefined;
  let data: VitestJson;
  try {
    data = JSON.parse(json.slice(start)) as VitestJson;
  } catch {
    return undefined;
  }
  const diagnostics: Diagnostic[] = [];
  for (const file of data.testResults ?? []) {
    const rel = toProjectRelative(projectRoot, file.name);
    const asserts = file.assertionResults ?? [];
    if (asserts.length === 0 && file.status === "failed") {
      diagnostics.push({
        validator: "tests",
        severity: "error",
        code: "TEST_FILE_FAILED",
        message: firstLine(file.message ?? "Test file failed to run."),
        file: rel,
        line: undefined,
        column: undefined,
      });
    }
    for (const a of asserts) {
      if (a.status !== "failed") continue;
      const msg = a.failureMessages?.[0] ?? "assertion failed";
      diagnostics.push({
        validator: "tests",
        severity: "error",
        code: "TEST_FAILED",
        message: `${a.fullName}: ${firstLine(msg)}`,
        file: rel,
        line: lineFromStack(msg, rel),
        column: undefined,
      });
      if (diagnostics.length >= MAX_DIAGNOSTICS_PER_VALIDATOR) break;
    }
  }
  return {
    total: data.numTotalTests ?? 0,
    failed: data.numFailedTests ?? diagnostics.length,
    passed: data.numPassedTests ?? 0,
    diagnostics,
  };
}

/** Build output: reuse the runtime supervisor's line parsers (tsc, vite, pnpm, generic errors). */
export function parseBuildOutput(projectRoot: string, output: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const raw of output.split(/\r?\n/)) {
    const d = extractDiagnostic("build", raw.replace(ANSI, ""));
    if (d?.severity !== "error") continue;
    const key = `${d.file ?? ""}:${String(d.line ?? "")}:${d.code ?? ""}:${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      validator: "build",
      severity: "error",
      code: d.code,
      message: d.message,
      file: d.file ? toProjectRelative(projectRoot, d.file) : undefined,
      line: d.line,
      column: d.column,
    });
    if (out.length >= MAX_DIAGNOSTICS_PER_VALIDATOR) break;
  }
  return out;
}

function firstLine(text: string): string {
  return text.replace(ANSI, "").split(/\r?\n/)[0]?.trim().slice(0, 400) ?? "";
}

function lineFromStack(stack: string, rel: string): number | undefined {
  const base = rel.split("/").pop() ?? rel;
  const m = new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+):\\d+`).exec(stack);
  return m?.[1] ? Number(m[1]) : undefined;
}
