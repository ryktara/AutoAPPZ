# Testing Strategy

| Layer | Tool | What | Where |
|---|---|---|---|
| Unit | Vitest | pure logic: state machines, path policy, schemas, parsers, routers, budgets | `packages/*/test` |
| Integration | Vitest (node) | command bus with real handlers, storage (in-memory SQLite), git (temp repos), project service, tool execution with permissions, fake model interactions, runtime supervisor with real child processes | `tests/integration` + package tests |
| E2E | Playwright (Electron) | critical journeys incl. the 14-step vertical slice, on ubuntu/windows/macos | `tests/e2e` |
| Evals | custom runner | prompts: simple page, CRUD app, auth, fix TS issue, fix broken build, modify existing project, refactor component, DB migration, add API endpoint, deploy; records success, iterations, tool calls, tokens, duration, regressions, unnecessary edits | `tests/evals` |
| Contract tests | Vitest | every provider/database/deploy adapter against recorded fixtures | `packages/integrations` |
| Property tests | fast-check | path safety, checkpoint undo, permission scope matching | packages |
| Security tests | Vitest (+ Playwright e2e) | threat-model controls T1–T8: frame trust, CSP, secrets never on the bus, path scoping, destructive consent, child env allowlist, log redaction, untrusted tool results, plugin import scan (`pnpm test:security`) | `tests/security/controls.test.ts` |
| Benchmarks | `tools/bench` | `pnpm bench` (index/retrieve/search/memory on a synthesized 2k-file app, checked against targets and baseline) and `pnpm bench:startup` | nightly `bench.yml` |
| Accessibility | Playwright + axe | WCAG 2.1 A/AA scans of every screen and tab (serious/critical = 0), keyboard operability, reduced motion | `tests/e2e/a11y.spec.ts` |

Rules: no test may be skipped per platform without an issue link; coverage thresholds for `core`, `tools`, `permissions`, `git`, `runtime` ≥ 80% lines; snapshot tests only for prompts and structured outputs, never for UI trees; flaky tests are quarantined with an owner and a deadline.

Determinism: fake model server with a fixture DSL (multi-turn tool calls), fake provider APIs (GitHub/Vercel/Supabase/Neon), seeded ids/clock via injected `Clock`/`IdSource`.
