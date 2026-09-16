import type { Language } from "../language.ts";
import { cssParser, genericParser, markdownParser } from "./others.ts";
import { typescriptParser } from "./typescript.ts";
import type { LanguageParser, ParsedFile } from "./types.ts";

const PARSERS: readonly LanguageParser[] = [typescriptParser, markdownParser, cssParser, genericParser];

export function parserFor(language: Language): LanguageParser {
  return PARSERS.find((p) => p.languages.includes(language)) ?? genericParser;
}

export function parseFile(relativePath: string, language: Language, text: string): ParsedFile {
  return parserFor(language).parse(relativePath, text);
}

/** Bump when parser output changes shape so existing indexes rebuild. */
export const PARSER_VERSION = 1;

export type {
  ChunkKind,
  LanguageParser,
  ParsedChunk,
  ParsedFile,
  ParsedImport,
  ParsedSymbol,
  SymbolKind,
} from "./types.ts";
