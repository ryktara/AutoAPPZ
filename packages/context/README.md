# @autoappz/context

Persistent, incremental, explainable context engine (ADR-009).

- `ProjectIndex` — per-project SQLite index: files, chunks (FTS5 trigram), symbols, imports, diagnostics, activity. Full index under ignore rules; incremental `indexPaths`.
- `retrieve()` — hybrid retrieval (lexical, structural, recency, diagnostics, selections) with per-phase weights, dedupe, budget packing and outline degradation; every item has `reasons[]`.
- `ContextEngine` — one index per open project, background `ensureIndexed`, `notifyChanged`, status events.
- `createContextTools()` — agent tools `search.code`, `code.findSymbol`, `code.whoImports`, `code.outline`.
- `renderContextForPrompt()` — `<context>` block delimited as data for prompts.

Tests include the retrieval benchmark on `test/fixtures/shop-app` (recall@budget ≥ 0.9) and the < 100 ms incremental re-index check. See `docs/architecture/CONTEXT.md`.
