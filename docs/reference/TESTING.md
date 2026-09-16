# Testing Architecture — `dyad-sh/dyad` @ `39064d24`

---

## 1. Inventory

| Layer | Tooling | Count | Location |
|---|---|---|---|
| Unit | Vitest 3 (`happy-dom`), project `unit` | ~620 `*.test.ts(x)` + 48 `*.spec.ts` (FSL tools use `.spec.ts`) | `src/**` |
| Integration ("hybrid harness") | Vitest project `integration`, `pool: forks`, `src/testing/hybrid.setup.ts` mocks Electron/PostHog/i18n/tsc/dependency analysis and drives real IPC handlers + real React components through an in-process bridge | 73 `*.integration.test.ts(x)` | `src/**` |
| Handler harness | `setupHandlerTestHarness` → in-memory SQLite + `invokeHandler(channel)`; `getRegisteredHandlerForTesting`; `setHandlerContextForTesting` | used by handler tests | `src/testing/*` |
| Electron E2E | Playwright 1.58 driving the **packaged** app (`npm run pre:e2e`); page objects; textual ARIA snapshots (no screenshots); fake LLM server per worker (`FAKE_LLM_BASE_PORT + index`); 4 shards × OS | 132 spec files (17 `local_agent_*`) | `e2e-tests/` |
| Fake providers | `testing/fake-llm-server` (Express): OpenAI chat completions with `tc=` test-case routing, Responses API, Anthropic messages, local-agent tool-call fixtures (`e2e-tests/fixtures/engine`), GitHub API + git push, Coolify, consent classifier, API-key validation, fake cloud sandbox; fake stdio/http/OAuth MCP servers | — | `testing/` |
| Evals | `vitest.eval.config.ts`: `tool_use.eval.ts`, `chat_history.eval.ts`, `compaction.eval.ts`, `plumbing_check.eval.ts`; recorded calls replay (`recorded_calls.spec.ts`) | 80 files incl. fixtures | `src/__tests__/evals/` |
| Script tests | `node --test` | 6 | `scripts/**` |
| Package tests | Vitest; `ts-pg-schema-diff` has Postgres-backed integration tests (CI installs PostgreSQL) | 4 | `packages/` |
| Benchmarks | code-explorer suite with pricing | — | `benchmarks/` |
| Storybook | 1 story | — | `.storybook/` |
| Snapshot tests | prompt assembly snapshots (`src/prompts/__snapshots__`), e2e request-body dumps (`snapshotServerDump`), ARIA snapshots | — | — |
| Type/lint gates | `npm run ts` (tsgo), `oxlint`, `oxfmt` in CI; husky pre-commit | — | CI |
| AI review | Claude/Codex PR review workflows, e2e de-flaking workflow | — | `.github/workflows` |

CI: mac + windows unit; mac (+windows for non-privileged authors) packaged e2e in 4 shards; safe-storage keychain e2e; sub-package tests on path change; merged Playwright blob reports. No Linux e2e.

## 2. Approximate coverage by subsystem (test files ÷ source files, non-FSL)

| Subsystem | Src | Tests | Ratio | Notes |
|---|---:|---:|---:|---|
| `ipc/handlers` | 76 | 100 | 1.3 | many integration tests |
| `ipc/processors` | 6 | 12 | 2.0 | tsc, code explorer, response processor |
| `ipc/utils` | 132 | 94 | 0.7 | uneven; git utils heavily tested |
| `ipc/services` | 58 | 40 | 0.7 | |
| `ipc/types` | 47 | 6 | 0.1 | contracts mostly untested directly |
| `chat_stream` | 16 | 11 | 0.7 | main actor cosim tests |
| `app_run` | 12 | 4 | 0.3 | |
| `state_machines` | 18 | 16 | 0.9 | |
| `window_infrastructure` | 16 | 13 | 0.8 | |
| `main` | 16 | 14 | 0.9 | |
| `lib` | 61 | 38 | 0.6 | |
| `prompts` | 13 | 5 | 0.4 | snapshots |
| `db` | 2 | 1 | 0.5 | |
| `components` | 363 | 102 | 0.3 | large components largely untested at unit level |
| `hooks` | 106 | 38 | 0.4 | |
| `pages` | 11 | 1 | 0.1 | |
| `atoms` | 16 | 4 | 0.3 | |
| `user_input` | 9 | 4 | 0.4 | |
| integrations (`supabase_admin`, `neon_admin`, `github_ops`, `coolify_*`, `distributed_machines`) | 66 | 56 | 0.8 | |
| `workers/code_explorer` | 9 | 0 (tests live under `ipc/processors`) | — | |
| `worker/` (injected preview scripts, proxy) | 10 | 0 | 0.0 | **no tests** |
| FSL local agent | 166 | ~70 `.spec/.test` | — | not inspected |

Line coverage is not measured in CI (no coverage reporter configured).

## 3. Important behaviors without (or with weak) tests

- Preview proxy injection and `dyad-shim.js` error reporting (0 tests; covered indirectly by `fix_error.spec.ts` which is skipped on Windows).
- Windows-specific runtime behaviors: several e2e are `testSkipIfWindows` (fix error, problems, plan mode, local agent basic, approve…), so **agent flows are effectively e2e-tested on macOS only**.
- Linux: no e2e at all.
- Process management edge cases: tree-kill timeouts, port collisions with foreign processes, GC races (unit tests exist for `process_manager` but not for real process trees).
- Auto-update flow (one e2e `auto_update.spec.ts` with mocked feed).
- Secrets: encryption round-trip tests exist; keychain identity regression is opt-in macOS-only.
- Renderer components >1k lines (`ChatInput`, `ChatTabs`, `PreviewIframe`, `TestsPanel`, `ModelPicker`) have thin unit coverage; behavior is covered through e2e snapshots, which are brittle (many `--update-snapshots` instructions in rules).
- Migrations: no test applies all 51 migrations against fixture databases from older versions (`db.test.ts` covers fresh init).
- Model provider adapters: `get_model_client` selection logic has tests; live provider behavior only via `*_real_api.spec.ts` (manual).
- Concurrency invariants ("no await between check and clear") are protected by comments and a few cosim tests, not by types.
- Evals are few (4 suites) and mostly plumbing; no measurable success-rate benchmark for generation quality.

## 4. Patterns worth learning from

- **Contract-derived test surface**: fake LLM server routes by `tc=` prompt prefixes and serves tool-call fixtures written in a small TypeScript DSL — deterministic multi-turn agent tests without a model.
- **Hybrid harness**: real handlers + real React through an in-process IPC bridge gives fast, high-fidelity integration tests without Electron.
- **Executable state-machine models + co-simulation** (`cosim.ts`) for actors.
- **Request-body snapshots** catch prompt regressions.
- **Change-aware CI** and sharded packaged e2e.
