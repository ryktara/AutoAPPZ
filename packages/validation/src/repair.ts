import type { Diagnostic, ValidationReport } from "./types.ts";

export const DEFAULT_REPAIR_DIAGNOSTICS = 12;

/** Diagnostics without duplicates (same file, line, code and message). */
export function uniqueDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const unique: Diagnostic[] = [];
  for (const d of diagnostics) {
    const key = `${d.file ?? ""}|${String(d.line ?? "")}|${d.code ?? ""}|${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(d);
  }
  return unique;
}

/**
 * Picks the diagnostics worth showing the builder: errors first, changed files first, deduplicated,
 * capped so the repair prompt stays focused.
 */
export function selectDiagnostics(
  report: ValidationReport,
  changedPaths: readonly string[],
  max = DEFAULT_REPAIR_DIAGNOSTICS,
): Diagnostic[] {
  const changed = new Set(changedPaths.map((p) => p.replace(/\\/g, "/")));
  const rank = (d: Diagnostic) => (d.severity === "error" ? 0 : 2) + (d.file && changed.has(d.file) ? 0 : 1);
  return uniqueDiagnostics(report.diagnostics)
    .sort(
      (a, b) =>
        rank(a) - rank(b) || (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0),
    )
    .slice(0, max);
}

/** Lines for the builder's "the checks failed" message. */
export function renderRepairNotes(diagnostics: readonly Diagnostic[], report: ValidationReport): string[] {
  const lines = diagnostics.map((d) => {
    const position =
      d.line !== undefined ? `:${String(d.line)}${d.column !== undefined ? `:${String(d.column)}` : ""}` : "";
    const where = d.file ? `${d.file}${position}` : "(project)";
    return `${d.validator}: ${where}${d.code ? ` ${d.code}` : ""} — ${d.message}`;
  });
  const hidden = uniqueDiagnostics(report.diagnostics).length - diagnostics.length;
  if (hidden > 0)
    lines.push(
      `(${String(hidden)} more diagnostic(s) not shown; fix these first and the checks will run again)`,
    );
  for (const r of report.results)
    if (r.status === "error" && r.note) lines.push(`${r.validator} could not run: ${r.note}`);
  return lines;
}

/** One-line summary for status lines and NEEDS_USER errors. */
export function summarizeReport(report: ValidationReport): string {
  const parts = report.results
    .filter((r) => r.status !== "skipped")
    .map(
      (r) =>
        `${r.validator} ${r.status}${r.diagnostics.length > 0 ? ` (${String(r.diagnostics.length)})` : ""}`,
    );
  return parts.length > 0 ? parts.join(", ") : "no validators applicable";
}
