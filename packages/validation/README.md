# @autoappz/validation

Validators with structured diagnostics feeding the repair loop (docs/architecture/AGENT.md, "validation & repair").

- Tiers: `syntax` (0) → `typecheck`, `lint` (1) → `tests` (2) → `build` (3). `runValidation` stops at the first failing tier; skipped validators carry a reason; tool failures are `error`, never `failed`.
- Parsers for tsc, ESLint JSON, Vitest JSON and build output are golden-tested.
- `selectDiagnostics` / `renderRepairNotes` pick a focused, deduplicated set for the builder; `summarizeReport` gives the one-line status.
- Everything runs as argument arrays with the runtime env allowlist, timeouts and cancellation; CLIs resolve from the project's `node_modules/.bin` (walking up), never through a shell.

Tests link the monorepo's `node_modules` into a copy of `test/fixtures/ts-app` and run the real tools.
