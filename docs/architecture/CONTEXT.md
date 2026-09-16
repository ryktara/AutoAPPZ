# Context Engine (`packages/context`)

Canonical design: `docs/design/CONTEXT-ENGINE.md`.

## Contracts
```ts
interface IndexStatus { projectId; state: "idle"|"indexing"|"ready"|"error"; files: number; indexed: number; lastFullAt?; lastIncrementalAt?; error? }
interface ContextItem { id; kind: "symbol"|"chunk"|"outline"|"diagnostic"|"diff"|"selection"|"memory"; path?; range?; text; tokens; score; reasons: Reason[] }
interface ContextPack { items: ContextItem[]; budget: TokenBudget; used: number; dropped: DroppedItem[] }
```

## Worker protocol
`utilityProcess` with request ids; operations `index.full`, `index.incremental(paths)`, `search`, `symbols`, `graph`, `retrieve`; memory budget enforced; crash → restart with backoff and status event.

## Storage
Per-project SQLite (`index.db`) with tables `files, chunks(+fts), symbols, imports, references, diagnostics, activity, meta`; schema versioned; corruption → rebuild.

## Parsers
Tree-sitter WASM grammars bundled for TS/TSX/JS/JSX, CSS/SCSS, JSON, YAML, Markdown, HTML, SQL; TypeScript language service on demand for definitions/references (bounded process, project-local `typescript` preferred).

## Ignore rules
`.gitignore` + platform defaults (`node_modules`, build outputs, lockfiles, binaries, files > 1 MB, secrets patterns). `.env*` never indexed.

## Implementation notes (M8)
- **Index:** `ProjectIndex` (one SQLite file per project under `<dataDir>/context/<projectId>/index.db`, WAL) with tables `files, chunks (+ FTS5 trigram index over text, identifiers and path tokens), symbols, imports, diagnostics, activity, meta`. Full index walks the tree under `.gitignore` + platform excludes (`node_modules`, build output, lockfiles, binaries, files > 1 MB; `.env*`, keys and credential files are never indexed), hashes each file and yields to the event loop every 25 files. Incremental `indexPaths` is synchronous and hash-compared (< 100 ms/file on the fixture suite). Import edges resolve relative and `@/`, `~/`, `src/` specifiers against indexed files. Corrupt files are deleted and rebuilt; a parser version bump clears the index.
- **Parsers:** heuristic extractors behind a `LanguageParser` interface — TS/JS (declarations, exports, React components, import forms; whole-declaration chunks), Markdown (sections), CSS (rules), generic windows for JSON/YAML/HTML/SQL/text. Tree-sitter WASM grammars are a drop-in replacement behind the same interface (ADR-009 addendum).
- **Retrieval:** `retrieve()` fuses lexical (FTS5 bm25), structural (one import hop around selections + top lexical files), recency (activity table fed by agent writes), diagnostics (table populated by validators from M10) and selections (plan step files, paths named in the request) with per-phase weights (plan/build/repair/ask); dedupes by range, caps any file at 45 % of the budget, packs greedily and degrades overflowing files to an outline item. Every item carries `reasons[]`.
- **Agent integration:** `TaskService` calls the `RetrievalSource` port before planner, builder (repair phase when the reviewer asked for changes) and ask steps, renders the pack as a `<context>` block delimited as data, publishes a `context` stream chunk (shown in the Execution pane as "Context: N excerpts …" with reasons), and notifies the index after every successful write. Tools `search.code`, `code.findSymbol`, `code.whoImports`, `code.outline` are registered alongside the fs tools.
- **Benchmarks:** `packages/context/test` runs the retrieval benchmark on the `shop-app` fixture (10 tasks with ground-truth files): recall@6k-token budget ≥ 0.9 is asserted in CI, as is the < 100 ms incremental re-index.
- **Deferred:** utility-process worker (indexing runs in-process but yields), tree-sitter grammars, TypeScript language-service queries, semantic/embedding plugin, co-change signals from git history, nested `.gitignore` files.
