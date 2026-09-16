import path from "node:path";

export type Language =
  "typescript" | "javascript" | "css" | "json" | "yaml" | "markdown" | "html" | "sql" | "text";

const BY_EXTENSION: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".css": "css",
  ".scss": "css",
  ".less": "css",
  ".json": "json",
  ".jsonc": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "markdown",
  ".mdx": "markdown",
  ".html": "html",
  ".htm": "html",
  ".sql": "sql",
  ".prisma": "text",
  ".txt": "text",
  ".toml": "text",
  ".env.example": "text",
};

export function languageOf(relativePath: string): Language | undefined {
  const ext = path.posix.extname(relativePath).toLowerCase();
  return BY_EXTENSION[ext];
}

/** Splits identifiers into searchable words: `getUserName` → get user name; `user_id` → user id. */
export function splitIdentifier(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase());
}

/** Path tokens for lexical matching: `src/api/reservations.ts` → src api reservations ts. */
export function pathTokens(relativePath: string): string[] {
  return relativePath
    .split(/[\\/.\-_]+/)
    .flatMap((t) => splitIdentifier(t))
    .filter((t) => t.length > 1);
}
