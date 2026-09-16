# AutoAPPZ Context Engine 2.0

Goal: outperform naive repository dumping and shallow symbol search with a persistent, incremental, explainable retrieval system whose every selected item carries a reason.

---

## 1. Index

Per-project SQLite (`<data>/projects/<id>/index.db`, WAL) owned by `packages/context`, built and maintained in a worker.

| Table | Contents |
|---|---|
| `files` | path, language, size, content hash, mtime, gitignored flag, generated flag, last indexed |
| `chunks` | file, range, kind (`function`, `class`, `block`, `markdown-section`, `config`), text hash; FTS5 index over chunk text + identifiers + path tokens (BM25) |
| `symbols` | name, kind, file, range, container, exported, signature (from tree-sitter; TS type info lazily) |
| `imports` | from file → to file/package, specifier kind |
| `references` | symbol → file/range (cheap: identifier matches confirmed by import resolution; precise via TS when available) |
| `diagnostics` | latest validator results by file/range |
| `activity` | recent edits (by task/user), timestamps, git diff hunks |
| `meta` | index version, parser versions, root hash |

Parsers: tree-sitter grammars (TS/TSX/JS/JSX, CSS/SCSS, JSON, YAML, Markdown, HTML, SQL, Prisma/Drizzle schema via TS) for symbols/imports/chunks; TypeScript language service (project-local `typescript` or bundled) for type-level queries on demand (definitions, references) with a bounded process.

Incremental updates: file watcher + tool write events → re-index changed files (hash-compared) and their dependents' import edges; git checkout/branch switch → diff-based reindex. Full rebuild only on version bump. Large repos: ignore rules (gitignore + platform excludes), size caps, priority queue (open files, recently edited first), background throttling, memory budget per worker.

---

## 2. Retrieval

Sources (each producing `ContextItem {id, kind, path, range, text, tokens, score, reasons[]}`):
1. **Lexical**: BM25 over chunks with query expansion (identifier splitting, stemming, synonyms from project memory).
2. **Structural**: seeds → import graph neighbors (1–2 hops), symbol definitions/references, co-changed files (git history).
3. **Recency**: files edited in this task/session, recent git diff hunks.
4. **Diagnostics**: files/ranges in current validator failures and test failures (highest priority in REPAIR).
5. **User-selected**: explicit selections (files, ranges, preview component selection) — always included.
6. **Blueprint/memory**: entities/pages named in the request → files that implement them (mapping maintained in memory).
7. **Semantic** (optional plugin): local embeddings (e.g., via an OpenAI-compatible embeddings endpoint or an on-device model) for chunks; merged by reciprocal rank fusion. Never required; disabled by default for privacy.

Scoring: weighted fusion with per-source weights by task phase (EXPLORE favors structural+lexical; REPAIR favors diagnostics+recency); MMR-style diversification; deduplicate overlapping ranges; prefer whole symbols over arbitrary windows.

Budgeting: `TokenBudget {total, perSource, reserved for plan/history}`; items packed greedily by score/tokens with minimum coverage guarantees (at least one item per referenced entity); overflow degrades to signatures/outlines ("file outline" items) before dropping.

Explainability: `reasons[]` like `lexical:"reservation" (bm25 12.3)`, `import-neighbor of src/api/reservations.ts`, `diagnostic TS2339 at line 42`, `user-selected`. Stored with the task and visible in the UI ("why is this here?").

---

## 3. API

```ts
interface ContextEngine {
  ensureIndexed(projectId, opts?: {priorityPaths?: string[]}): Promise<IndexStatus>;
  retrieve(req: {projectId, taskId, phase, query, seeds?: Seed[], diagnostics?: Diagnostic[], selections?: Selection[], budget: TokenBudget}): Promise<ContextPack>;
  search(projectId, query, opts): Promise<SearchHit[]>;         // for tools and UI
  symbols(projectId, {name?, file?, kind?}): Promise<Symbol[]>;
  graph(projectId, {file, direction, depth}): Promise<GraphSlice>;
  notifyChanged(projectId, paths: string[]): void;
  status(projectId): IndexStatus;                                 // for UI: indexing progress, coverage
}
```

Tools exposed to the agent: `search_code` (ranked, with reasons), `find_symbol`, `who_imports`, `outline_file`, `read_file` (range-aware; records read hashes for optimistic concurrency).

---

## 4. Performance targets (to be measured; see BENCHMARKS.md)

- Cold index of a 2k-file TS app: < 20 s in background, UI usable immediately.
- Incremental re-index of one file: < 100 ms.
- Retrieval for a query with budget 30k tokens: < 300 ms warm.
- Memory: worker < 512 MB for 10k files (chunks stored in SQLite, not RAM).

---

## 5. Evaluation

Retrieval benchmark: a task suite with ground-truth "files that must be touched"; metrics recall@budget, precision, tokens used; compared to (a) whole-repo dump, (b) symbol-name search only. Tracked in CI on fixture repos.
