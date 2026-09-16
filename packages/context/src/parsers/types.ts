import type { Language } from "../language.ts";

export type SymbolKind =
  "function" | "class" | "interface" | "type" | "enum" | "variable" | "component" | "section" | "rule";

export interface ParsedSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly startLine: number;
  readonly endLine: number;
  readonly exported: boolean;
  readonly container?: string | undefined;
  readonly signature: string;
}

export interface ParsedImport {
  /** Module specifier as written (`./api/users`, `react`). */
  readonly specifier: string;
  readonly kind: "static" | "dynamic" | "require" | "reexport";
  readonly line: number;
}

export type ChunkKind = "function" | "class" | "block" | "markdown-section" | "config";

export interface ParsedChunk {
  readonly kind: ChunkKind;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  /** Identifiers declared/used prominently in the chunk (for lexical boosting). */
  readonly identifiers: readonly string[];
}

export interface ParsedFile {
  readonly language: Language;
  readonly symbols: readonly ParsedSymbol[];
  readonly imports: readonly ParsedImport[];
  readonly chunks: readonly ParsedChunk[];
}

export interface LanguageParser {
  readonly languages: readonly Language[];
  parse(relativePath: string, text: string): ParsedFile;
}

/** Split text into fixed windows with overlap when a file has no structural boundaries. */
export function windowChunks(
  lines: readonly string[],
  kind: ChunkKind,
  windowLines = 60,
  overlap = 8,
): ParsedChunk[] {
  const chunks: ParsedChunk[] = [];
  if (lines.length === 0) return chunks;
  let start = 0;
  while (start < lines.length) {
    const end = Math.min(lines.length, start + windowLines);
    const slice = lines.slice(start, end);
    chunks.push({
      kind,
      startLine: start + 1,
      endLine: end,
      text: slice.join("\n"),
      identifiers: identifiersIn(slice.join("\n")),
    });
    if (end >= lines.length) break;
    start = end - overlap;
  }
  return chunks;
}

const IDENT = /[A-Za-z_$][A-Za-z0-9_$]{2,}/g;
const STOP = new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "import",
  "export",
  "from",
  "default",
  "class",
  "extends",
  "interface",
  "type",
  "enum",
  "async",
  "await",
  "new",
  "this",
  "true",
  "false",
  "null",
  "undefined",
  "void",
  "typeof",
  "instanceof",
  "for",
  "while",
  "else",
  "switch",
  "case",
  "break",
  "continue",
  "throw",
  "try",
  "catch",
  "finally",
  "string",
  "number",
  "boolean",
  "readonly",
  "static",
  "public",
  "private",
  "protected",
  "implements",
  "require",
  "module",
  "exports",
]);

export function identifiersIn(text: string, limit = 64): string[] {
  const seen = new Map<string, number>();
  for (const m of text.matchAll(IDENT)) {
    const id = m[0];
    if (STOP.has(id)) continue;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}
