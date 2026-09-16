# Code Intelligence — `dyad-sh/dyad` @ `39064d24`

How the reference explores and indexes a codebase, its measured weaknesses, and the target for AutoAPPZ (design detail in `docs/design/CONTEXT-ENGINE.md`).

---

## 1. Components

| Component | Location | Role |
|---|---|---|
| Repository scan (legacy context) | `src/utils/codebase.ts` | `git ls-files` (native git) with excluded dirs/files, fallback recursive walk honoring `.gitignore`; allowlisted extensions; 1 MB file cap; mtime-sorted; per-app include/exclude globs (`chatContext`); content cache (500 entries, mtime-keyed) |
| ripgrep search | `app_handlers.ts` `searchAppFilesWithRipgrep`, `ripgrep_utils.ts`; agent `grep` tool (FSL) | `rg --json --fixed-strings --ignore-case --max-filesize` with excluded globs; UTF-8 byte→char offset mapping for snippets |
| Code Explorer (TS symbol graph) | `workers/code_explorer/*` (utility process), host `src/ipc/processors/code_explorer.ts`, scheduler `typescript_utility_process_scheduler.ts` | Builds a `ts.Program` from `tsconfig.app.json`/`tsconfig.json` (or workspace `apps/*`, `packages/*` configs, ≤40), walks declarations into a **graph**: nodes `file, class, interface, function, method, variable, property, type, enum`; edges `contains, imports, calls, references, extends, implements`. Query → `extractTerms` (camelCase split, stop words, light stemming/expansion) → scored hits → files with symbols and source windows, truncated by `maxFiles/maxDepth` |
| Explorer sub-agent (Pro) | FSL `explore_code_subagent*.ts` | "compiler-backed Explorer" persona: uses the index + reads to produce a cited report ("starting map") |
| Chat-history search | FTS5 `chat_search_fts` + dirty queues + `ChatSearchIndexer` (FSL) | `search_chats`/`read_chat`/`explore_chat_history` tools; app search UI |
| Supabase dependency analysis | `workers/supabase_dependency_analysis` | which edge functions are affected by a shared-module change |

### 1.1 Code Explorer details (Apache)
- Compiler resolution: prefer the app's local `typescript` (must be installed and expose required APIs), else bundled `@typescript/typescript6` fallback with a recorded reason.
- Process model: one resident `utilityProcess` shared across apps, correlated request IDs, idle timeout 5 min, crash-loop detection (60 s window), index cache budget 2 GB / 4 entries with eviction plan; heap bounded by V8 pointer compression (~4 GB).
- Scheduling: `TypeScriptUtilityProcessScheduler.runExclusive(kind)` serializes `code-explorer`, `tsc`, and `supabase-dependency-analysis` operations; incompatible resident processes are stopped first.
- Availability: requires TypeScript installed in the app and a tsconfig; UI helper `ensureCodeExplorerReady` in e2e.
- Benchmarks: `benchmarks/code-explorer/` runs task suites with pricing; smoke/full modes (results not in repo).

### 1.2 What is absent
- No embeddings/semantic retrieval in the OSS region (vendor "smart context" is server-side).
- No persistent index on disk (index lives in the worker's memory; `tsBuildInfoCacheDir` for tsc only).
- No incremental indexing: re-indexing rebuilds the program (eviction/idle rules mitigate).
- No import-graph-based relevance for non-TS files (CSS, JSON, MD are outside the graph).
- No dependency graph across packages beyond tsconfig project references.
- No "recent edits / diagnostics / test failure" context sources; provenance is limited to git hashes in the transcript.

---

## 2. Measured/observed weaknesses

| Weakness | Evidence | Consequence |
|---|---|---|
| Whole-program build per query session | `buildIndex` over all `program.getSourceFiles()` in project source | Seconds to minutes on large apps; memory-bound; single serialized lane blocks type-checks |
| Naive lexical scoring | `search.ts`: term extraction + stop words + hard-coded stem expansions; no BM25/TF-IDF across files, no path weighting (`UNVERIFIED` scoring internals beyond head) | Queries like "checkout flow" rank by symbol-name overlap only |
| TS-only | graph built from TS AST | Vite React apps with JS/JSX are covered, but CSS/config/markdown/SQL are invisible to the graph |
| No persistence | in-memory cache, evicted | Every session pays the index cost again |
| No incremental updates | none | Edits during a turn make the index stale until rebuilt |
| No diagnostics→context loop | tsc results are a separate report | Model must re-read files to relate errors to code |
| Legacy context dump | `extractCodebase` formats every file into `<dyad-file>` blocks | Token blow-ups; mitigated by omitting low-signal files; now dormant |
| Ripgrep search not ranked | file-level results with snippets | fine for UI, weak for model relevance |
| Chat-history retrieval is FTS-only | FTS5 + BM25 (FSL `bm25.ts` name suggests BM25 for chat text) | ok for recall, no cross-linking to code |

---

## 3. Target for AutoAPPZ (summary; full design in `docs/design/CONTEXT-ENGINE.md`)

1. **Persistent, incremental project index** stored per project (SQLite in the project's platform-owned metadata dir, never in the user's repo): file table (path, hash, mtime, language, size), symbol table (name, kind, range, container), import edges, call/reference edges where cheap, and a lexical inverted index (BM25) over identifiers/comments/paths.
2. **Multi-language parsing** via Tree-sitter grammars (TS/TSX/JS, CSS, JSON, Markdown, SQL, HTML, YAML) for symbols and imports; TypeScript program used lazily for type-level queries only.
3. **Hybrid retrieval**: lexical (BM25 over chunks) + structural (import/call graph expansion from seeds) + recency (git diff, recent edits) + diagnostics (tsc/eslint/test failures mapped to ranges) + explicit user selections; optional local embeddings as a plug-in, never required.
4. **Token budgeting** with per-source quotas, deduplication by range, and an explainable "why included" record per item.
5. **Incremental updates** driven by a file watcher and the agent's own write events; index invalidation per file hash.
6. **Worker isolation** with bounded memory, per-project eviction, and a separate lane for type-checking so exploration never blocks validation.
7. **Measured**: index time, query latency, recall on a benchmark task suite (Phase 33/45).
