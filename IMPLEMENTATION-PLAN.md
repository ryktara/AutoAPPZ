# AutoAPPZ Implementation Plan

> **Status (2026-09-16):** M0–M14 implemented and committed on `main`; see `docs/STATUS.md` for the verified/CI-only/deferred breakdown. Items marked deferred in that page were scaled down explicitly rather than left half-built.

Milestones are independently verifiable. Each defines scope, dependencies, deliverables, tests, acceptance criteria and explicit exclusions. The first production-quality vertical slice (M0–M10 subset) must be excellent before breadth (M11–M14).

Legend: **AC** = acceptance criterion (must be test-enforced where stated).

---

## M0 — Repository, CI, formatting, testing foundations
- **Scope:** pnpm workspace; package skeletons with interface stubs and READMEs (`contracts, command-bus, core, agent, ai-providers, tools, project, runtime, git, storage, secrets, diagnostics, permissions, validation, context, integrations, plugins, ui, testing`); TS project references (strict); ESLint boundaries; Prettier; Vitest; Playwright scaffold; changesets; CI matrix (ubuntu/windows/macos); clean-room CI grep; LICENSE/NOTICE/SECURITY/CONTRIBUTING.
- **Deps:** none. **Deliverables:** `pnpm check` green; `apps/desktop` boots an empty window.
- **Tests:** boundary lint test; smoke E2E launching the app.
- **AC:** CI green on 3 OSes; no `any`/`ts-ignore` allowed by lint; reference-identifier grep = 0.
- **Excludes:** any feature code.

## M1 — Desktop shell and secure command bus
- **Scope:** hardened `BrowserWindow` (sandbox, CSP, nav/popup denial), preload exposing only bus primitives, `packages/command-bus` (envelopes, validation, cancellation, streams, subscriptions, capability tokens), `packages/contracts` conventions, `packages/diagnostics` structured logging with ids, `packages/storage` DB bootstrap + migrations, `packages/secrets` (keychain-backed, references, redaction).
- **Deps:** M0. **Deliverables:** `settings.*`, `secrets.*` commands; settings UI shell.
- **Tests:** untrusted-frame rejection; input/output validation; cancel propagation; secret never in renderer payloads (fixture scan); CSP header test.
- **AC:** THREAT-MODEL controls B1 implemented; 100% of bus handlers validated (registry test).
- **Excludes:** projects, agent.

## M2 — Projects and persistence
- **Scope:** `packages/project` catalog (create from template, import in place/copy, open, rename, delete with safeguards), templates registry with `react-vite` template, project settings, Project Memory store, Blueprint model (persisted), requirements/AC tables; UI: project list, create/import dialogs, workspace shell layout (three panes + dock, empty states).
- **Deps:** M1. **Tests:** catalog CRUD; template copy portability (no `@autoappz/*` in package.json); import does not execute anything (process spy).
- **AC:** create → reopen after restart works; deletion never removes in-place imported directories without explicit confirmation.
- **Excludes:** agent, runtime.

## M3 — AI provider abstraction
- **Scope:** `packages/ai-providers` adapters (OpenAI, Anthropic, Google, xAI, OpenAI-compatible, Ollama), capability catalog, `ModelRouter`, token/cost estimation, usage records; provider settings UI with key validation; `packages/testing` fake model server (streaming + tool calls, fixture DSL).
- **Deps:** M1. **Tests:** adapter contract tests against recorded fixtures; router policy tests; cost math.
- **AC:** any adapter can be swapped in the fake harness; user override always wins (test).
- **Excludes:** agent loop.

## M4 — Chat + streaming
- **Scope:** sessions/messages in storage; `task.submit` (read-only "ask" tasks), streaming to UI with seq/backpressure, cancellation, error surfaces, cost display per task; workspace Request pane.
- **Deps:** M2, M3. **Tests:** stream ordering/dedupe; cancel mid-stream persists partial; crash-resume marks interrupted.
- **AC:** first token overhead < 300 ms in harness; no dropped/duplicated messages under rapid submit (fuzz test).

## M5 — Filesystem tools + Tool Runtime + permissions
- **Scope:** `packages/tools` SDK, permission engine (`packages/permissions`), audit log, tools: `fs.read/list/write/patch/delete/rename`, `search.text` (ripgrep), `fs.outline`; read-before-write and hash checks; consent UI (once/session/project/deny) with deadlines.
- **Deps:** M4. **Tests:** path-policy property tests (traversal, symlinks, root, UNC, drive); conflict detection; audit completeness (every tool call → row).
- **AC:** 100% privileged tools pass schema+permission validation and audit (registry test).

## M6 — Agent planning and execution
- **Scope:** `packages/core` task state machine + journal + recovery; `packages/agent` roles with complexity profiles; prompt templates with snapshot tests; plan approval UI; execution pane (tool activity), changes pane (diff viewer).
- **Deps:** M5. **Tests:** state-machine table tests; recovery into VALIDATE; approval/revise/reject; bounded steps/budgets.
- **AC:** trivial task = single model sequence (call-count test); plan visible before execution when policy requires.

## M7 — Runtime supervisor + preview
- **Scope:** `packages/runtime` phases (install/serve/build/test), port leases, health probes, log ring buffers, crash backoff, preview proxy + minimal instrumentation, Runtime Observer events, preview pane with error banner, dock (Problems/Terminal/Logs/Tests).
- **Deps:** M2. **Tests:** phase attribution; foreign-port conflict → lease new port (no kill); health degraded detection; Windows/macOS/Linux process tree termination.
- **AC:** app runs and preview appears for the template; runtime error captured and surfaced within 2 s.

## M8 — Code intelligence (Context Engine)
- **Scope:** `packages/context` index worker (tree-sitter, FTS5, graph), incremental updates, retrieval with reasons, budgeting, tools `search_code/find_symbol/who_imports/outline_file`; UI "why included".
- **Deps:** M5. **Tests:** index correctness on fixtures; incremental update timing; retrieval benchmark harness.
- **AC:** retrieval benchmark recall@budget ≥ 0.9 on fixture suite; reindex < 100 ms/file.

## M9 — Git checkpoints
- **Scope:** `packages/git` (dugite), checkpoint refs capturing user changes, task commits with trailers, undo/restore file/compare/branch-from/continue-from, uncommitted-changes surface, branches list/switch, commit UI with hooks.
- **Deps:** M6. **Tests:** property test "undo never loses user edits"; merge/rebase-in-progress refusal; large binary caps.
- **AC:** every writable task produces a checkpoint and a commit with trailer.

## M10 — Automatic validation/repair
- **Scope:** `packages/validation` validators (syntax, typecheck, lint, affected tests, build, runtime smoke, browser check), Diagnostic model + parsers, repair-loop driver (bounded), NEEDS_USER surfaces; Validation pane.
- **Deps:** M6, M7, M8, M9. **Tests:** parser golden tests per tool; repair eval suite with injected errors.
- **AC:** ≥ 95% recovery on injected-error suite; no infinite loops (max attempts test).
- **Vertical slice checkpoint:** the 14-step slice passes as a deterministic E2E on 3 OSes.

## M11 — Database integrations
- **Scope:** `packages/integrations/database` interface + Postgres (local/Docker), Supabase, Neon adapters; migrations tooling in templates (`fullstack-postgres`); schema tools; destructive-SQL protection; integrations hub UI.
- **Deps:** M10. **Tests:** adapter contract tests with mocked APIs + local Postgres in CI.
- **AC:** template app with auth + CRUD generated and validated end-to-end against local Postgres.

## M12 — Deployment
- **Scope:** deployment adapters (Vercel, Netlify, Cloudflare, generic Docker), readiness checklist, env sync; templates `nextjs`, `saas`, `dashboard`.
- **Deps:** M11. **Tests:** mocked provider APIs; Docker build of generated apps in CI.
- **AC:** generated projects deploy without AutoAPPZ present (portability check).

## M13 — MCP / extensions
- **Scope:** MCP client (stdio/http/OAuth), per-tool consent via permission engine, plugin SDK + loader + sample plugin, plugin management UI.
- **Deps:** M5. **Tests:** fake MCP servers; capability enforcement; SDK compatibility suite.
- **AC:** a plugin cannot access capabilities beyond its manifest (test).

## M14 — Hardening, benchmarks, accessibility, security
- **Scope:** benchmark suite + CI trend; accessibility audit (WCAG AA, keyboard, screen reader, reduced motion); security test suite (threat-model controls); diagnostics bundles; release process with signing/provenance; docs completion.
- **Deps:** all. **AC:** BENCHMARKS targets met or explicitly re-baselined; axe checks pass; security suite green; release build signed on all platforms.

---

## Per-task procedure (binding)
1. Read the relevant architecture doc and ADRs. 2. Write/confirm acceptance criteria. 3. Inspect affected modules. 4. Write/update tests. 5. Implement. 6. Run targeted tests. 7. `pnpm typecheck`. 8. `pnpm lint`. 9. Integration tests where relevant. 10. Inspect the diff. 11. Verify no unrelated modifications. 12. Update docs if behavior changed. Never lower strictness or disable tests to go green.
