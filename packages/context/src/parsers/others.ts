import {
  identifiersIn,
  windowChunks,
  type LanguageParser,
  type ParsedChunk,
  type ParsedSymbol,
} from "./types.ts";

/** Markdown: one chunk and one `section` symbol per heading. */
export const markdownParser: LanguageParser = {
  languages: ["markdown"],
  parse(_relativePath, text) {
    const lines = text.split("\n");
    const symbols: ParsedSymbol[] = [];
    const chunks: ParsedChunk[] = [];
    let start = 0;
    let title = "";
    const flush = (end: number) => {
      const slice = lines.slice(start, end);
      if (slice.join("").trim().length === 0) return;
      chunks.push({
        kind: "markdown-section",
        startLine: start + 1,
        endLine: end,
        text: slice.join("\n"),
        identifiers: identifiersIn(slice.join("\n"), 32),
      });
      if (title)
        symbols.push({
          name: title,
          kind: "section",
          startLine: start + 1,
          endLine: end,
          exported: true,
          signature: title,
        });
    };
    for (let i = 0; i < lines.length; i++) {
      const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i] ?? "");
      if (h && i > start) {
        flush(i);
        start = i;
      }
      if (h) title = h[2] ?? "";
    }
    flush(lines.length);
    return { language: "markdown", symbols, imports: [], chunks };
  },
};

/** CSS/SCSS: chunk per top-level rule block (selectors become `rule` symbols). */
export const cssParser: LanguageParser = {
  languages: ["css"],
  parse(_relativePath, text) {
    const lines = text.split("\n");
    const symbols: ParsedSymbol[] = [];
    const chunks: ParsedChunk[] = [];
    let depth = 0;
    let blockStart = -1;
    let selector = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const ch of line) {
        if (ch === "{") {
          if (depth === 0) {
            blockStart = i;
            selector = line.slice(0, line.indexOf("{")).trim();
          }
          depth += 1;
        } else if (ch === "}") {
          depth -= 1;
          if (depth === 0 && blockStart >= 0) {
            const chunkText = lines.slice(blockStart, i + 1).join("\n");
            chunks.push({
              kind: "block",
              startLine: blockStart + 1,
              endLine: i + 1,
              text: chunkText,
              identifiers: identifiersIn(chunkText, 24),
            });
            if (selector)
              symbols.push({
                name: selector.slice(0, 120),
                kind: "rule",
                startLine: blockStart + 1,
                endLine: i + 1,
                exported: true,
                signature: selector.slice(0, 160),
              });
            blockStart = -1;
          }
        }
      }
    }
    return {
      language: "css",
      symbols,
      imports: [],
      chunks: chunks.length > 0 ? chunks : windowChunks(lines, "block"),
    };
  },
};

/** JSON/YAML/HTML/SQL/text: windowed config chunks, top-level JSON keys as symbols. */
export const genericParser: LanguageParser = {
  languages: ["json", "yaml", "html", "sql", "text"],
  parse(relativePath, text) {
    const lines = text.split("\n");
    const symbols: ParsedSymbol[] = [];
    if (/\.jsonc?$/.test(relativePath)) {
      for (let i = 0; i < lines.length; i++) {
        const k = /^\s{2}"([^"]+)"\s*:/.exec(lines[i] ?? "");
        if (k?.[1])
          symbols.push({
            name: k[1],
            kind: "variable",
            startLine: i + 1,
            endLine: i + 1,
            exported: true,
            signature: (lines[i] ?? "").trim().slice(0, 120),
          });
      }
    }
    const language = /\.ya?ml$/.test(relativePath)
      ? "yaml"
      : /\.jsonc?$/.test(relativePath)
        ? "json"
        : /\.html?$/.test(relativePath)
          ? "html"
          : relativePath.endsWith(".sql")
            ? "sql"
            : "text";
    return { language, symbols, imports: [], chunks: windowChunks(lines, "config", 80, 6) };
  },
};
