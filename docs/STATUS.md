# Implementation status (M0–M14)

Last updated: 2026-09-16 after M14. Every milestone in `IMPLEMENTATION-PLAN.md` has landed; this page records what is verified, what is verified only in CI, and what is explicitly deferred. Nothing here is copied from a reference product (see `docs/legal/REFERENCE-LICENSE-AUDIT.md`; `pnpm clean-room:check` runs in CI).

## Verified locally and in CI

| Area | Evidence |
|---|---|
| Monorepo, strict TypeScript, lint/format, unit + integration + security suites | `pnpm check` (typecheck of 4 projects, ESLint strict type-checked, Prettier, 280+ Vitest tests incl. `tests/security`) |
| Electron hardening, typed command bus, secrets by reference | `apps/desktop/test`, `tests/security/controls.test.ts` (T1–T2), `tests/e2e/app.spec.ts` |
| Projects, templates (`react-vite`, `fullstack-postgres`, `nextjs`, `dashboard`), portability | `tests/e2e/projects.spec.ts`; CI `templates` matrix builds each template outside the workspace; `docker-build` builds each template's image |
| Providers (OpenAI, Anthropic, Google, xAI, OpenAI-compatible, Ollama) with a fake model server | `packages/ai-providers/test`, `tests/e2e/providers.spec.ts`, `chat.spec.ts` |
| Agent loop: plan → approve → consent → tools → validate → repair → review → checkpoint | `packages/core/test/build-flow.test.ts`, `tests/e2e/build.spec.ts` |
| Permissions and tools (fs, search, code, db, MCP, plugin tools) | `packages/permissions`, `packages/tools`, `packages/integrations`, `packages/plugins` tests; T3–T8 controls |
| Runtime supervisor + preview proxy | `packages/runtime/test`, `tests/e2e/runtime.spec.ts` (real `pnpm install`, dev server, preview, runtime error capture) |
| Context engine (index, retrieval with reasons, budgeting) | benchmark: recall@6k ≥ 0.9 on the fixture suite; incremental re-index < 100 ms; `tools/bench` |
| Git checkpoints, undo, branches, commits with trailers | `packages/git/test` incl. the property test "undo never loses user edits"; e2e |
| Validation/repair (syntax, typecheck, lint, tests, build) and Diagnose & fix | `packages/validation/test` on real tsc/eslint/vitest; repair suite recovery ≥ 95 %; e2e Validation tab |
| Database integrations (Postgres/Supabase/Neon), SQL classification, destructive refusal | `packages/integrations/test/database.test.ts` (PGlite + mocked management APIs); e2e Database card |
| Deployment adapters (Vercel/Netlify/Cloudflare/Docker), readiness, env sync | `packages/integrations/test/deployment.test.ts` (mocked provider APIs); e2e Deploy card |
| MCP (stdio, HTTP, OAuth loopback), plugin loader with capability enforcement | `packages/integrations/test/mcp.test.ts`, `packages/plugins/test`; e2e Extensions |
| Accessibility (axe WCAG 2.1 AA serious/critical = 0, keyboard, reduced motion) | `tests/e2e/a11y.spec.ts` |
| Diagnostics bundle (redacted) | Settings → About → Export diagnostics bundle |
| Benchmarks with targets and baseline | `pnpm bench` (indexing, retrieval, search, memory), `pnpm bench:startup`; nightly `bench.yml`; numbers in `docs/performance/BENCHMARKS.md` |

## Verified in CI only

- `fullstack-postgres` end to end against a PostgreSQL service (`template-postgres` job) and the real-Postgres gateway tests (`AUTOAPPZ_TEST_DATABASE_URL`) — the local machine had no running Docker daemon during M11.
- E2E on macOS and Linux (`e2e` matrix); locally verified on Windows.

## UNVERIFIED / deferred (explicit)

- **Live provider APIs for deployment and databases** (Vercel, Netlify, Cloudflare Pages, Supabase, Neon management APIs) follow public references and are exercised against mocked servers only. First live use per provider is a validation step.
- **Code signing and notarization** run only when CI secrets exist; not executed with real certificates here.
- **Auto-update feeds**, signed plugin registry, MCP resources/prompts, per-project MCP servers, validator/template/UI-panel plugin contributions in the host.
- **Container runtime profile** (project processes run on the host), interactive terminal, runtime-smoke and browser-check validators.
- **`saas` template** (needs the payments integration design), Neon branch-per-task, registry push for Docker images.
- Tree-sitter grammars and a utility-process index worker (heuristic parsers run in-process; benchmark targets are met without them).
- Startup benchmarks on macOS/Linux and the 10k-file monorepo fixtures (nightly job collects them; no baseline committed yet).
