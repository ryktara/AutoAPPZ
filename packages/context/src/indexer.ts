import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { Logger } from "@autoappz/diagnostics";
import { IgnoreRules, MAX_INDEXED_FILE_BYTES, looksBinary } from "./ignore.ts";
import { openIndexDb } from "./index-db.ts";
import { languageOf, pathTokens, splitIdentifier } from "./language.ts";
import { PARSER_VERSION, parseFile, type ParsedFile } from "./parsers/index.ts";
import { estimateTokens } from "./tokens.ts";

export interface IndexStatus {
  readonly state: "idle" | "indexing" | "ready" | "error";
  readonly files: number;
  readonly indexed: number;
  readonly lastFullAt?: number | undefined;
  readonly lastIncrementalAt?: number | undefined;
  readonly error?: string | undefined;
}

export interface ChunkRow {
  readonly id: number;
  readonly path: string;
  readonly kind: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly tokens: number;
}

export interface SymbolRow {
  readonly path: string;
  readonly name: string;
  readonly kind: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly exported: boolean;
  readonly container: string | undefined;
  readonly signature: string;
}

export interface SearchHit extends ChunkRow {
  /** Positive relevance (negated FTS5 bm25). */
  readonly score: number;
}

export interface ActivityRow {
  readonly path: string;
  readonly kind: string;
  readonly actor: string;
  readonly taskId: string | undefined;
  readonly at: number;
}

export interface DiagnosticRow {
  readonly path: string;
  readonly line: number | undefined;
  readonly code: string | undefined;
  readonly message: string;
  readonly source: string;
  readonly at: number;
}

export interface ProjectIndexOptions {
  root: string;
  /** SQLite file for this project's index; ":memory:" for tests. */
  dbFile: string;
  logger?: Logger | undefined;
  now?: (() => number) | undefined;
  /** Files processed between event-loop yields during a full index. */
  batchSize?: number | undefined;
}

const RESOLVE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".scss",
];

/**
 * Index of one project: walks the tree under the ignore rules, parses supported files into chunks,
 * symbols and imports, stores them in SQLite and answers lexical/structural queries. Re-indexing is
 * per file and hash-compared, so unchanged files cost one stat.
 */
export class ProjectIndex {
  readonly root: string;
  private readonly db: Database.Database;
  private readonly log: Logger | undefined;
  private readonly now: () => number;
  private readonly batchSize: number;
  private state: IndexStatus["state"] = "idle";
  private lastFullAt: number | undefined;
  private lastIncrementalAt: number | undefined;
  private lastError: string | undefined;
  private fullInFlight: Promise<IndexStatus> | undefined;
  private readonly stmts;

  constructor(options: ProjectIndexOptions) {
    this.root = options.root;
    this.log = options.logger;
    this.now = options.now ?? Date.now;
    this.batchSize = options.batchSize ?? 25;
    this.db = openOrRebuild(options.dbFile, this.log);
    this.stmts = prepare(this.db);
    const meta = this.stmts.getMeta.get("parser_version") as { value: string } | undefined;
    if (meta && Number(meta.value) !== PARSER_VERSION) this.clearAll();
    this.stmts.setMeta.run("parser_version", String(PARSER_VERSION));
    const full = this.stmts.getMeta.get("last_full_at") as { value: string } | undefined;
    if (full) {
      this.lastFullAt = Number(full.value);
      this.state = "ready";
    }
  }

  status(): IndexStatus {
    const files = (this.stmts.countFiles.get() as { n: number }).n;
    const s: IndexStatus = { state: this.state, files, indexed: files };
    return {
      ...s,
      ...(this.lastFullAt !== undefined ? { lastFullAt: this.lastFullAt } : {}),
      ...(this.lastIncrementalAt !== undefined ? { lastIncrementalAt: this.lastIncrementalAt } : {}),
      ...(this.lastError !== undefined ? { error: this.lastError } : {}),
    };
  }

  /** Walks the project and (re)indexes changed files; removed files are dropped. Concurrent calls share one run. */
  fullIndex(signal?: AbortSignal): Promise<IndexStatus> {
    if (this.fullInFlight) return this.fullInFlight;
    this.fullInFlight = this.runFullIndex(signal).finally(() => {
      this.fullInFlight = undefined;
    });
    return this.fullInFlight;
  }

  private async runFullIndex(signal?: AbortSignal): Promise<IndexStatus> {
    this.state = "indexing";
    this.lastError = undefined;
    try {
      const ignore = IgnoreRules.fromProject(this.root);
      const seen = new Set<string>();
      let processed = 0;
      for (const rel of walk(this.root, ignore)) {
        if (signal?.aborted) throw new Error("Indexing cancelled.");
        seen.add(rel);
        this.indexOne(rel);
        processed += 1;
        if (processed % this.batchSize === 0) await new Promise<void>((r) => setImmediate(r));
      }
      const known = (this.stmts.allPaths.all() as { path: string }[]).map((r) => r.path);
      const remove = known.filter((p) => !seen.has(p));
      if (remove.length > 0) this.removePaths(remove);
      this.resolveAllImports();
      this.lastFullAt = this.now();
      this.stmts.setMeta.run("last_full_at", String(this.lastFullAt));
      this.state = "ready";
      this.log?.info("index complete", { root: this.root, files: seen.size, removed: remove.length });
    } catch (error) {
      this.state = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      this.log?.warn("index failed", { root: this.root, message: this.lastError });
    }
    return this.status();
  }

  /** Re-indexes specific files (missing → removed). Synchronous; cheap enough for tool-write hooks. */
  indexPaths(paths: readonly string[]): { indexed: number; removed: number } {
    const ignore = IgnoreRules.fromProject(this.root);
    let indexed = 0;
    let removed = 0;
    const tx = this.db.transaction(() => {
      for (const raw of paths) {
        const rel = raw.replace(/\\/g, "/").replace(/^\.\//, "");
        const abs = path.join(this.root, rel);
        if (!existsSync(abs) || ignore.ignores(rel, false) || !statSync(abs).isFile()) {
          if (this.stmts.hasFile.get(rel)) {
            this.removePaths([rel]);
            removed += 1;
          }
          continue;
        }
        if (this.indexOne(rel)) indexed += 1;
      }
    });
    tx();
    if (indexed + removed > 0) {
      this.resolveImportsFor(paths.map((p) => p.replace(/\\/g, "/")));
      this.lastIncrementalAt = this.now();
      if (this.state === "idle") this.state = "ready";
    }
    return { indexed, removed };
  }

  removePaths(paths: readonly string[]): void {
    const tx = this.db.transaction(() => {
      for (const p of paths) {
        this.stmts.deleteFts.run(p);
        this.stmts.deleteChunks.run(p);
        this.stmts.deleteSymbols.run(p);
        this.stmts.deleteImports.run(p);
        this.stmts.unlinkImportTarget.run(p);
        this.stmts.deleteFile.run(p);
      }
    });
    tx();
  }

  /** Returns true when the file was (re)indexed, false when unchanged or skipped. */
  private indexOne(rel: string): boolean {
    const abs = path.join(this.root, rel);
    let st;
    try {
      st = statSync(abs);
    } catch {
      return false;
    }
    if (st.size > MAX_INDEXED_FILE_BYTES) return false;
    const language = languageOf(rel);
    if (!language) return false;
    const buffer = readFileSync(abs);
    if (looksBinary(buffer)) return false;
    const hash = createHash("sha1").update(buffer).digest("hex");
    const existing = this.stmts.getFile.get(rel) as { hash: string } | undefined;
    if (existing?.hash === hash) return false;
    const text = buffer.toString("utf8");
    const parsed = parseFile(rel, language, text);
    this.store(rel, language, st.size, hash, Math.trunc(st.mtimeMs), text.split("\n").length, parsed);
    return true;
  }

  private store(
    rel: string,
    language: string,
    size: number,
    hash: string,
    mtime: number,
    lines: number,
    parsed: ParsedFile,
  ): void {
    const tx = this.db.transaction(() => {
      this.stmts.deleteFts.run(rel);
      this.stmts.deleteChunks.run(rel);
      this.stmts.deleteSymbols.run(rel);
      this.stmts.deleteImports.run(rel);
      this.stmts.upsertFile.run(rel, language, size, hash, mtime, lines, this.now());
      const ptoks = pathTokens(rel).join(" ");
      for (const c of parsed.chunks) {
        const info = this.stmts.insertChunk.run(
          rel,
          c.kind,
          c.startLine,
          c.endLine,
          c.text,
          estimateTokens(c.text),
        );
        const identifiers = c.identifiers.flatMap((id) => [id, ...splitIdentifier(id)]).join(" ");
        this.stmts.insertFts.run(Number(info.lastInsertRowid), c.text, identifiers, ptoks);
      }
      for (const s of parsed.symbols)
        this.stmts.insertSymbol.run(
          rel,
          s.name,
          s.kind,
          s.startLine,
          s.endLine,
          s.exported ? 1 : 0,
          s.container ?? null,
          s.signature,
        );
      for (const i of parsed.imports) this.stmts.insertImport.run(rel, i.specifier, null, i.kind, i.line);
    });
    tx();
  }

  private resolveAllImports(): void {
    const rows = this.stmts.unresolvedImports.all() as {
      rowid: number;
      from_path: string;
      specifier: string;
    }[];
    const tx = this.db.transaction(() => {
      for (const r of rows) {
        const to = this.resolveSpecifier(r.from_path, r.specifier);
        if (to) this.stmts.setImportTarget.run(to, r.rowid);
      }
    });
    tx();
  }

  private resolveImportsFor(paths: readonly string[]): void {
    const tx = this.db.transaction(() => {
      for (const p of paths) {
        const rows = this.stmts.importsFrom.all(p) as { rowid: number; specifier: string }[];
        for (const r of rows) {
          const to = this.resolveSpecifier(p, r.specifier);
          this.stmts.setImportTarget.run(to ?? null, r.rowid);
        }
        // A new file may satisfy previously unresolved imports pointing at it.
        for (const r of this.stmts.unresolvedImports.all() as {
          rowid: number;
          from_path: string;
          specifier: string;
        }[]) {
          const to = this.resolveSpecifier(r.from_path, r.specifier);
          if (to) this.stmts.setImportTarget.run(to, r.rowid);
        }
      }
    });
    tx();
  }

  /** Relative and `@/`, `~/`, `src/` aliased specifiers resolve against indexed files; packages stay null. */
  private resolveSpecifier(fromPath: string, specifier: string): string | undefined {
    let base: string;
    if (specifier.startsWith("."))
      base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
    else if (specifier.startsWith("@/") || specifier.startsWith("~/")) base = `src/${specifier.slice(2)}`;
    else if (specifier.startsWith("src/")) base = specifier;
    else return undefined;
    const candidates = [base];
    const stripped = base.replace(/\.(m|c)?js$/, "");
    if (stripped !== base)
      candidates.push(`${stripped}.ts`, `${stripped}.tsx`, `${stripped}.mts`, `${stripped}.cts`);
    for (const ext of RESOLVE_EXTENSIONS) candidates.push(`${base}${ext}`);
    for (const ext of RESOLVE_EXTENSIONS) candidates.push(`${base}/index${ext}`);
    for (const c of candidates) if (this.stmts.hasFile.get(c)) return c;
    return undefined;
  }

  // ---- queries -------------------------------------------------------------------------------------

  /** FTS5 search over chunk text, identifiers and path tokens; terms are OR-ed so recall stays high. */
  search(
    query: string,
    options: { limit?: number | undefined; pathPrefix?: string | undefined } = {},
  ): SearchHit[] {
    const match = toFtsQuery(query);
    if (!match) return [];
    const limit = options.limit ?? 20;
    const rows = (
      options.pathPrefix
        ? this.stmts.searchPrefix.all(match, `${options.pathPrefix.replace(/\/$/, "")}/%`, limit)
        : this.stmts.search.all(match, limit)
    ) as (ChunkRowRaw & { score: number })[];
    return rows.map((r) => ({ ...toChunk(r), score: -r.score }));
  }

  symbols(filter: {
    name?: string | undefined;
    path?: string | undefined;
    kind?: string | undefined;
    limit?: number | undefined;
  }): SymbolRow[] {
    const rows = this.stmts.symbols.all({
      like: filter.name ? `%${filter.name}%` : "%",
      name: filter.name ?? "",
      path: filter.path ?? null,
      kind: filter.kind ?? null,
      limit: filter.limit ?? 50,
    }) as SymbolRowRaw[];
    return rows.map(toSymbol);
  }

  outline(p: string): SymbolRow[] {
    return (this.stmts.outline.all(p) as SymbolRowRaw[]).map(toSymbol);
  }

  importers(p: string): string[] {
    return (this.stmts.importers.all(p) as { from_path: string }[]).map((r) => r.from_path);
  }

  importsOf(p: string): string[] {
    return (this.stmts.importTargets.all(p) as { to_path: string }[]).map((r) => r.to_path);
  }

  chunksFor(p: string): ChunkRow[] {
    return (this.stmts.chunksFor.all(p) as ChunkRowRaw[]).map(toChunk);
  }

  hasFile(p: string): boolean {
    return this.stmts.hasFile.get(p) !== undefined;
  }

  listFiles(): string[] {
    return (this.stmts.allPaths.all() as { path: string }[]).map((r) => r.path);
  }

  recordActivity(
    paths: readonly string[],
    kind: "edit" | "read" | "create" | "delete",
    actor: "agent" | "user",
    taskId?: string,
  ): void {
    const at = this.now();
    const tx = this.db.transaction(() => {
      for (const p of paths)
        this.stmts.insertActivity.run(p.replace(/\\/g, "/"), kind, actor, taskId ?? null, at);
    });
    tx();
  }

  recentActivity(sinceMs: number, limit = 50): ActivityRow[] {
    return (
      this.stmts.recentActivity.all(this.now() - sinceMs, limit) as {
        path: string;
        kind: string;
        actor: string;
        task_id: string | null;
        at: number;
      }[]
    ).map((r) => ({
      path: r.path,
      kind: r.kind,
      actor: r.actor,
      taskId: r.task_id ?? undefined,
      at: r.at,
    }));
  }

  /** Replaces the diagnostics of one source (e.g. "tsc") with the latest run. */
  setDiagnostics(source: string, rows: readonly Omit<DiagnosticRow, "source" | "at">[]): void {
    const at = this.now();
    const tx = this.db.transaction(() => {
      this.stmts.deleteDiagnostics.run(source);
      for (const d of rows)
        this.stmts.insertDiagnostic.run(
          d.path.replace(/\\/g, "/"),
          d.line ?? null,
          d.code ?? null,
          d.message,
          source,
          at,
        );
    });
    tx();
  }

  diagnostics(limit = 100): DiagnosticRow[] {
    return (
      this.stmts.diagnostics.all(limit) as {
        path: string;
        line: number | null;
        code: string | null;
        message: string;
        source: string;
        at: number;
      }[]
    ).map((r) => ({
      path: r.path,
      line: r.line ?? undefined,
      code: r.code ?? undefined,
      message: r.message,
      source: r.source,
      at: r.at,
    }));
  }

  close(): void {
    this.db.close();
  }

  private clearAll(): void {
    this.db.exec(
      "DELETE FROM chunks_fts; DELETE FROM chunks; DELETE FROM symbols; DELETE FROM imports; DELETE FROM files; DELETE FROM meta;",
    );
    this.lastFullAt = undefined;
    this.state = "idle";
  }
}

interface ChunkRowRaw {
  id: number;
  path: string;
  kind: string;
  start_line: number;
  end_line: number;
  text: string;
  tokens: number;
}
interface SymbolRowRaw {
  path: string;
  name: string;
  kind: string;
  start_line: number;
  end_line: number;
  exported: number;
  container: string | null;
  signature: string;
}

const toChunk = (r: ChunkRowRaw): ChunkRow => ({
  id: r.id,
  path: r.path,
  kind: r.kind,
  startLine: r.start_line,
  endLine: r.end_line,
  text: r.text,
  tokens: r.tokens,
});
const toSymbol = (r: SymbolRowRaw): SymbolRow => ({
  path: r.path,
  name: r.name,
  kind: r.kind,
  startLine: r.start_line,
  endLine: r.end_line,
  exported: r.exported === 1,
  container: r.container ?? undefined,
  signature: r.signature,
});

function prepare(db: Database.Database) {
  return {
    getMeta: db.prepare("SELECT value FROM meta WHERE key = ?"),
    setMeta: db.prepare(
      "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ),
    countFiles: db.prepare("SELECT COUNT(*) AS n FROM files"),
    allPaths: db.prepare("SELECT path FROM files"),
    getFile: db.prepare("SELECT hash FROM files WHERE path = ?"),
    hasFile: db.prepare("SELECT 1 FROM files WHERE path = ?"),
    upsertFile: db.prepare(
      "INSERT INTO files(path, language, size, hash, mtime, lines, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET language = excluded.language, size = excluded.size, hash = excluded.hash, mtime = excluded.mtime, lines = excluded.lines, indexed_at = excluded.indexed_at",
    ),
    deleteFile: db.prepare("DELETE FROM files WHERE path = ?"),
    insertChunk: db.prepare(
      "INSERT INTO chunks(path, kind, start_line, end_line, text, tokens) VALUES (?, ?, ?, ?, ?, ?)",
    ),
    insertFts: db.prepare(
      "INSERT INTO chunks_fts(rowid, text, identifiers, path_tokens) VALUES (?, ?, ?, ?)",
    ),
    deleteFts: db.prepare("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE path = ?)"),
    deleteChunks: db.prepare("DELETE FROM chunks WHERE path = ?"),
    insertSymbol: db.prepare(
      "INSERT INTO symbols(path, name, kind, start_line, end_line, exported, container, signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    deleteSymbols: db.prepare("DELETE FROM symbols WHERE path = ?"),
    insertImport: db.prepare(
      "INSERT INTO imports(from_path, specifier, to_path, kind, line) VALUES (?, ?, ?, ?, ?)",
    ),
    deleteImports: db.prepare("DELETE FROM imports WHERE from_path = ?"),
    unresolvedImports: db.prepare(
      "SELECT rowid, from_path, specifier FROM imports WHERE to_path IS NULL AND (specifier LIKE './%' OR specifier LIKE '../%' OR specifier LIKE '@/%' OR specifier LIKE '~/%' OR specifier LIKE 'src/%')",
    ),
    importsFrom: db.prepare("SELECT rowid, specifier FROM imports WHERE from_path = ?"),
    setImportTarget: db.prepare("UPDATE imports SET to_path = ? WHERE rowid = ?"),
    unlinkImportTarget: db.prepare("UPDATE imports SET to_path = NULL WHERE to_path = ?"),
    search: db.prepare(
      "SELECT c.id, c.path, c.kind, c.start_line, c.end_line, c.text, c.tokens, bm25(chunks_fts, 1.0, 2.0, 1.5) AS score FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid WHERE chunks_fts MATCH ? ORDER BY score LIMIT ?",
    ),
    searchPrefix: db.prepare(
      "SELECT c.id, c.path, c.kind, c.start_line, c.end_line, c.text, c.tokens, bm25(chunks_fts, 1.0, 2.0, 1.5) AS score FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid WHERE chunks_fts MATCH ? AND c.path LIKE ? ORDER BY score LIMIT ?",
    ),
    symbols: db.prepare(
      "SELECT path, name, kind, start_line, end_line, exported, container, signature FROM symbols WHERE name LIKE @like AND (@path IS NULL OR path = @path) AND (@kind IS NULL OR kind = @kind) ORDER BY (name = @name) DESC, exported DESC, path, start_line LIMIT @limit",
    ),
    outline: db.prepare(
      "SELECT path, name, kind, start_line, end_line, exported, container, signature FROM symbols WHERE path = ? ORDER BY start_line",
    ),
    importers: db.prepare("SELECT DISTINCT from_path FROM imports WHERE to_path = ? ORDER BY from_path"),
    importTargets: db.prepare(
      "SELECT DISTINCT to_path FROM imports WHERE from_path = ? AND to_path IS NOT NULL ORDER BY to_path",
    ),
    chunksFor: db.prepare(
      "SELECT id, path, kind, start_line, end_line, text, tokens FROM chunks WHERE path = ? ORDER BY start_line",
    ),
    insertActivity: db.prepare("INSERT INTO activity(path, kind, actor, task_id, at) VALUES (?, ?, ?, ?, ?)"),
    recentActivity: db.prepare(
      "SELECT path, kind, actor, task_id, at FROM activity WHERE at >= ? ORDER BY at DESC LIMIT ?",
    ),
    deleteDiagnostics: db.prepare("DELETE FROM diagnostics WHERE source = ?"),
    insertDiagnostic: db.prepare(
      "INSERT INTO diagnostics(path, line, code, message, source, at) VALUES (?, ?, ?, ?, ?, ?)",
    ),
    diagnostics: db.prepare(
      "SELECT path, line, code, message, source, at FROM diagnostics ORDER BY at DESC LIMIT ?",
    ),
  };
}

function openOrRebuild(file: string, log: Logger | undefined): Database.Database {
  try {
    return openIndexDb(file);
  } catch (error) {
    if (file === ":memory:") throw error;
    log?.warn("index database unreadable; rebuilding", {
      file,
      message: error instanceof Error ? error.message : String(error),
    });
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(file + suffix);
      } catch {
        /* absent */
      }
    }
    return openIndexDb(file);
  }
}

function* walk(root: string, ignore: IgnoreRules, rel = ""): Generator<string> {
  const abs = rel ? path.join(root, rel) : root;
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (ignore.ignores(childRel, true)) continue;
      yield* walk(root, ignore, childRel);
    } else if (e.isFile()) {
      if (ignore.ignores(childRel, false)) continue;
      yield childRel;
    }
  }
}

/** Builds an FTS5 MATCH expression: quoted terms (≥ 3 chars for the trigram tokenizer), OR-ed. */
export function toFtsQuery(query: string): string | undefined {
  const words = new Set<string>();
  for (const raw of query.split(/[^A-Za-z0-9_$./-]+/)) {
    for (const w of [raw, ...splitIdentifier(raw)]) {
      const t = w.trim().replace(/^[./-]+|[./-]+$/g, "");
      if (t.length >= 3 && !FTS_STOP.has(t.toLowerCase())) words.add(t.toLowerCase());
    }
  }
  if (words.size === 0) return undefined;
  return [...words]
    .slice(0, 24)
    .map((w) => `"${w.replace(/"/g, '""')}"`)
    .join(" OR ");
}

const FTS_STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "when",
  "then",
  "than",
  "add",
  "make",
  "change",
  "update",
  "please",
  "should",
  "would",
  "could",
  "can",
  "use",
  "using",
  "new",
  "all",
  "any",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "not",
  "but",
  "its",
  "our",
  "your",
  "you",
  "their",
  "them",
  "they",
  "will",
]);
