import type { Language } from "../language.ts";
import {
  identifiersIn,
  windowChunks,
  type LanguageParser,
  type ParsedChunk,
  type ParsedFile,
  type ParsedImport,
  type ParsedSymbol,
  type SymbolKind,
} from "./types.ts";

/**
 * Heuristic TypeScript/JavaScript extractor. Recognises top-level declarations, exported members, React
 * components (capitalised function/const returning JSX is approximated by name + `.tsx`/`.jsx`) and import
 * forms. Ranges close at the matching brace when one opens on the declaration line, else at the next blank
 * line. A tree-sitter backend can replace this behind the same `LanguageParser` interface (ADR-009 addendum).
 */
export const typescriptParser: LanguageParser = {
  languages: ["typescript", "javascript"],
  parse(relativePath, text): ParsedFile {
    const language: Language = /\.[cm]?jsx?$/.test(relativePath) ? "javascript" : "typescript";
    const lines = text.split("\n");
    const symbols = extractSymbols(lines, relativePath);
    const imports = extractImports(lines);
    const chunks = chunksFromSymbols(lines, symbols);
    return { language, symbols, imports, chunks };
  },
};

const DECL =
  /^(?<export>export\s+(?:default\s+)?)?(?:declare\s+)?(?:(?<async>async\s+)?function\*?\s+(?<fn>[A-Za-z_$][\w$]*)|(?<abstract>abstract\s+)?class\s+(?<cls>[A-Za-z_$][\w$]*)|interface\s+(?<iface>[A-Za-z_$][\w$]*)|type\s+(?<type>[A-Za-z_$][\w$]*)\b|(?:const\s+)?enum\s+(?<enum>[A-Za-z_$][\w$]*)|(?:const|let|var)\s+(?<variable>[A-Za-z_$][\w$]*))/;
const EXPORT_DEFAULT_ANON = /^export\s+default\s+(?:async\s+)?(?:function|class)?\s*[({]/;

function extractSymbols(lines: readonly string[], relativePath: string): ParsedSymbol[] {
  const out: ParsedSymbol[] = [];
  const jsx = /\.[jt]sx$/.test(relativePath);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = DECL.exec(line);
    if (!m?.groups) {
      if (EXPORT_DEFAULT_ANON.test(line)) {
        out.push({
          name: "default",
          kind: "function",
          startLine: i + 1,
          endLine: closeRange(lines, i),
          exported: true,
          signature: line.trim().slice(0, 160),
        });
      }
      continue;
    }
    const g = m.groups;
    const name = g["fn"] ?? g["cls"] ?? g["iface"] ?? g["type"] ?? g["enum"] ?? g["variable"];
    if (!name) continue;
    let kind: SymbolKind = g["fn"]
      ? "function"
      : g["cls"]
        ? "class"
        : g["iface"]
          ? "interface"
          : g["type"]
            ? "type"
            : g["enum"]
              ? "enum"
              : "variable";
    if (kind === "variable" && /=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>/.test(line))
      kind = "function";
    if ((kind === "function" || kind === "variable") && jsx && /^[A-Z]/.test(name)) kind = "component";
    out.push({
      name,
      kind,
      startLine: i + 1,
      endLine: closeRange(lines, i),
      exported: g["export"] !== undefined,
      signature: line
        .trim()
        .replace(/\s*\{\s*$/, "")
        .slice(0, 160),
    });
  }
  // `export { a, b }` / `export default Name` mark earlier declarations as exported.
  const exportedNames = new Set<string>();
  for (const line of lines) {
    const list = /^export\s*\{([^}]*)\}/.exec(line);
    if (list?.[1])
      for (const part of list[1].split(",")) {
        const name = part
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (name) exportedNames.add(name);
      }
    const def = /^export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/.exec(line);
    if (def?.[1]) exportedNames.add(def[1]);
  }
  return out.map((s) => (exportedNames.has(s.name) ? { ...s, exported: true } : s));
}

/** Finds the line closing the brace opened on `start`; falls back to the next blank line / EOF. */
function closeRange(lines: readonly string[], start: number): number {
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length; i++) {
    const line = stripStringsAndComments(lines[i] ?? "");
    for (const ch of line) {
      if (ch === "{") {
        depth += 1;
        opened = true;
      } else if (ch === "}") depth -= 1;
    }
    if (opened && depth <= 0) return i + 1;
    if (!opened && i > start && line.trim() === "") return i;
    if (!opened && i - start > 3) return Math.min(lines.length, start + 1);
  }
  return lines.length;
}

function stripStringsAndComments(line: string): string {
  return line.replace(/\/\/.*$/, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

const IMPORT_STATIC = /^\s*import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/;
const IMPORT_REEXPORT = /^\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s+)?from\s+['"]([^'"]+)['"]/;
const IMPORT_DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const IMPORT_REQUIRE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractImports(lines: readonly string[]): ParsedImport[] {
  const out: ParsedImport[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const s = IMPORT_STATIC.exec(line);
    if (s?.[1]) out.push({ specifier: s[1], kind: "static", line: i + 1 });
    const r = IMPORT_REEXPORT.exec(line);
    if (r?.[1]) out.push({ specifier: r[1], kind: "reexport", line: i + 1 });
    for (const d of line.matchAll(IMPORT_DYNAMIC))
      if (d[1]) out.push({ specifier: d[1], kind: "dynamic", line: i + 1 });
    for (const q of line.matchAll(IMPORT_REQUIRE))
      if (q[1]) out.push({ specifier: q[1], kind: "require", line: i + 1 });
  }
  return out;
}

/** One chunk per top-level symbol (whole declarations beat arbitrary windows); gaps become blocks. */
function chunksFromSymbols(lines: readonly string[], symbols: readonly ParsedSymbol[]): ParsedChunk[] {
  const top = symbols.filter((s) => s.container === undefined).sort((a, b) => a.startLine - b.startLine);
  if (top.length === 0) return windowChunks(lines, "block");
  const chunks: ParsedChunk[] = [];
  let cursor = 1;
  const push = (kind: ParsedChunk["kind"], startLine: number, endLine: number, extra: string[] = []) => {
    if (endLine < startLine) return;
    const text = lines.slice(startLine - 1, endLine).join("\n");
    if (text.trim().length === 0) return;
    chunks.push({
      kind,
      startLine,
      endLine,
      text,
      identifiers: [...new Set([...extra, ...identifiersIn(text)])],
    });
  };
  for (const s of top) {
    if (s.startLine <= cursor - 1) continue; // nested/overlapping declaration
    if (s.startLine > cursor) push("block", cursor, s.startLine - 1);
    const end = Math.max(s.endLine, s.startLine);
    const kind =
      s.kind === "class" ? "class" : s.kind === "function" || s.kind === "component" ? "function" : "block";
    // Large symbols are windowed so a single chunk never dominates the budget.
    if (end - s.startLine > 160) {
      for (const w of windowChunks(lines.slice(s.startLine - 1, end), kind, 120, 10))
        chunks.push({
          ...w,
          startLine: w.startLine + s.startLine - 1,
          endLine: w.endLine + s.startLine - 1,
          identifiers: [s.name, ...w.identifiers],
        });
    } else push(kind, s.startLine, end, [s.name]);
    cursor = end + 1;
  }
  if (cursor <= lines.length) push("block", cursor, lines.length);
  return chunks;
}
