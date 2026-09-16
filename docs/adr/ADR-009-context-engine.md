# ADR-009: Context Engine

**Status:** Accepted · **Date:** 2026-09-16

## Context
Naive repository dumping wastes tokens; symbol-name-only search misses relevance; the reference's TS-program index is in-memory, TS-only and non-incremental.

## Decision
`packages/context` implements a persistent, incremental per-project index (SQLite FTS5 + tree-sitter symbols + import graph + diagnostics + activity) with hybrid retrieval (lexical + structural + recency + diagnostics + user selections; optional semantic plugin), token budgeting, deduplication, and an explanation per selected item. See `docs/design/CONTEXT-ENGINE.md`.

## Alternatives
Vendor smart-context service (violates local-first/provider independence), embeddings-only (needs a model, opaque), whole-repo dump (does not scale).

## Consequences
Index worker + grammars bundled; benchmark suite maintained; ~1–2 MB of WASM grammars in the app.

## Migration impact
None.
