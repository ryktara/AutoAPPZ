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
