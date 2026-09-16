# Repository Map — `dyad-sh/dyad` @ `39064d24`

Inventory of the reference repository with the **responsibility** of each area, derived from reading entry points, build configs and file listings (not from directory names alone). Counts exclude `node_modules`. Line counts are TS/TSX/JS.

Legal boundary reminder: `src/pro/**` is FSL-restricted; it is listed here for boundary mapping only (see [REFERENCE-LICENSE-AUDIT](../legal/REFERENCE-LICENSE-AUDIT.md)).

---

## 1. Top level

| Path | Files | Lines | Responsibility | Evidence |
|------|------:|------:|----------------|----------|
| `src/` | 2,178 | ~524k | The whole application: main process, renderer, shared types, tests. **One tree for all Electron processes** — no physical main/renderer split. | `forge.config.ts` entries all point into `src/` |
| `src/pro/` | 172 | ~58.8k | **Restricted (FSL).** Local agent runtime (tools, subagents, loop), search/replace edit DSL, visual editing, themes, annotator. | `src/pro/LICENSE`; `docs/agent_architecture.md` |
| `workers/` | 13 | ~2.4k | Two Node worker entry points built as separate bundles: `code_explorer` (TypeScript-program-based code exploration; `core/`, `eviction.ts`) and `supabase_dependency_analysis`. | `forge.config.ts`, `vite.*-worker.config.mts` |
| `worker/` (singular) | 10 | ~4.8k | **Runtime scripts injected into the user's previewed app** and the preview proxy: `proxy_server.js` (worker_threads HTTP/WS forwarder), `dyad-shim.js` (in-iframe navigation/history bridge → parent via `postMessage`), `dyad-sw.js` + `dyad-sw-register.js` (service worker capturing network requests), `dyad-component-selector-client.js`, `dyad-visual-editor-client.js`, `dyad-screenshot-client.js`, `dyad-recorder-client.js`, `dyad-auth-bootstrap.js`, `dyad_logs.js`. Not bundled by Vite; copied verbatim (packager `ignore` keeps `/worker`). | `forge.config.ts` ignore fn; file headers |
| `shared/` | 7 | 390 | Types/utilities shared between main and workers (`code_explorer_types.ts`, `supabase_dependency_analysis_types.ts`, `ports.ts`, `normalizePath.ts`, `xmlEscape.ts`, `node_module_resolution.ts`, `dyadAttachment.ts`). | imports from `workers/` and `src/` |
| `packages/` | 52 | ~14.2k | Local packages: `ts-pg-schema-diff` (Postgres schema diffing, has Postgres-backed integration tests), `pg-schema-classifier` (classifies SQL statements/schemas), `@dyad-sh/react-vite-component-tagger` and `@dyad-sh/nextjs-webpack-component-tagger` (build plugins that tag JSX with source locations, installed **into generated apps** — see `scaffold/package.json` devDeps). | `package.json` `file:` deps; `scaffold/package.json` |
| `scaffold/` | 79 | ~5.3k | The default **React + Vite + shadcn/Radix + Tailwind 3 + React Router 6** template copied into new apps, with `AI_RULES.md` (stack rules injected into prompts) and `vercel.json`. Uses pnpm. | `scaffold/package.json`, `scaffold/AI_RULES.md` |
| `drizzle/` | 102 | — | 51 SQL migrations + `meta/` journal for the internal SQLite DB. | `drizzle.config.ts` |
| `e2e-tests/` | 542 | ~23.4k | 132 Playwright specs against the packaged Electron app, textual `snapshots/`, `fixtures/` (incl. `fixtures/engine` tool-call fixtures), `helpers/`. | `playwright.config.ts` |
| `testing/` | 25 | ~6.3k | Deterministic fakes for e2e/integration: `fake-llm-server` (OpenAI chat + Responses API, Anthropic messages, local-agent tool-call fixtures, GitHub, Coolify, consent classifier, API-key validation), fake stdio/http/oauth MCP servers. | `testing/README.md`, `playwright.config.ts#webServer` |
| `scripts/` | 44 | ~6.0k | Dev supervisor (`start-supervisor.mjs`), version bump, release tag/provenance/verify, keychain-reader rebuild, CI helpers, AI PR-review and issue-triage tooling, crash-frame resolver. | `package.json#scripts` |
| `benchmarks/` | 5 | ~3.9k | Code-explorer benchmark runner + task suite + pricing table. | `npm run benchmark:code-explorer*` |
| `native/` | 5 | — | `keychain-reader` node-gyp addon (macOS keychain access, optionalDependency). | `package.json#optionalDependencies` |
| `makers/` | 1 | 212 | Custom Electron Forge AppImage maker. | `forge.config.ts` |
| `docs/` | 13 | — | Maintainer docs: `architecture.md`, `agent_architecture.md`, `security.md`, `why-state-machines.md`, `i18n.md`, `codex-subscription.md`, `user-input-follow-up-recovery.md`, ADRs (`adr/`, `adrs/`). | — |
| `rules/` | 30 | — | Engineering rules consumed by humans and AI agents (IPC, errors, state machines, hybrid testing, safe storage, windows spawn, etc.). Indexed by `AGENTS.md`. | `AGENTS.md` |
| `plans/` | 91 | — | Design/implementation plans (many AI-generated: `claude-*`, `codex-*`), e.g. state-machine migrations, code explorer, undo/redo, cloud sandboxes, distributed machines. Useful as **intent** evidence. | — |
| `assets/` | 13 | — | Icons/branding — **never reused**. | — |
| `.github/` | 30 | — | 21 workflows (CI, release, AI review/triage, CLA, hygiene), issue templates. | — |
| `.claude/`, `.agents/`, `.cursor/` | 68 | — | AI-assistant configuration (skills, settings, hooks). | — |
| `.storybook/` | 2 | 42 | Storybook config (1 story exists). | — |
| `.devcontainer/`, `.husky/`, `tools/` | 4 | — | Devcontainer, git hooks, macOS cert helper. | — |

Root files of note: `forge.config.ts` (packaging), 6 `vite.*.config.mts`, `vitest.config.ts`, `vitest.eval.config.ts`, `playwright.config.ts`, `drizzle.config.ts`, `biome.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `AGENTS.md`, `PRODUCT.md` (product brief), `CLA.md`, `SECURITY.md`, `LICENSE`, `NOTICE`, `windowsSign.ts`, `merge.config.ts`.

---

## 2. `src/` — process entry points

| File | Process | Responsibility |
|------|---------|----------------|
| `src/main_bootstrap.ts` | main | Squirrel-startup guard; defers `import("./main")`; races runtime load vs `app.whenReady()` and shows an error dialog if main failed to register pre-ready handlers. |
| `src/main.ts` (~63 KB) | main | App lifecycle, window creation (`webPreferences` at ~L896), navigation guards, deep-link (`dyad://`) handling, auto-update, crash reporter + minidump/OOM classification, settings/safe-storage recovery, DB init, orphan-resource reconciliation (Neon test branches, Supabase test users, e2e workspaces), startup of chat-search indexer and subagent recovery (FSL imports), performance monitoring, telemetry. |
| `src/preload.ts` | preload | `contextBridge` exposing `window.electron.ipcRenderer.{invoke, invokeEnvelope, send, on, removeListener, removeAllListeners}` with channel allowlists, plus `webFrame` zoom. |
| `src/renderer.tsx` | renderer | React root, providers (Query, Jotai, Router, i18n, theme), error boundaries. |
| `src/router.ts`, `src/routes/` | renderer | TanStack Router route tree (16 files). |
| `src/backup_manager.ts` | main | SQLite/settings backup. |

---

## 3. `src/` — subdirectories

| Path | Files | Lines | Process | Responsibility (traced) |
|------|------:|------:|---------|--------------------------|
| `src/ipc/` | 588 | ~169k | main (+ shared types) | The IPC layer and most main-process logic. See §4. |
| `src/components/` | 465 | ~100k | renderer | React components: `chat/` (161 — chat UI, message parts, tool-call cards, markdown parser for `<dyad-*>` tags), `preview_panel/` (88 — preview iframe, code view, problems, terminal, console, tests), `settings/`, `ui/` (33 base-ui wrappers), `plugins/`, `media-library/`, `security/`, plus 142 root-level components (app list, sidebar, dialogs, title bar, etc.). |
| `src/hooks/` | 144 | ~20k | renderer | React hooks, mostly TanStack-Query wrappers per IPC endpoint (`useAgentTools`, `useGithubOps`, …). |
| `src/atoms/` | 20 | ~2.5k | renderer | Jotai atoms (client state; ownership rules in `rules/jotai-state.md`). |
| `src/pages/` | 12 | ~3.4k | renderer | Route pages (home, chat, settings, app details, hub, library …). |
| `src/state_machines/` | 34 | ~9k | main + renderer | Explicit state machines and hosts ("main-owned state machines", `docs/adr/main-owned-state-machines.md`, `rules/state-machines.md`). |
| `src/chat_stream/` | 27 | ~11k | main + renderer | Chat streaming actor/definition/projection (`definition.ts` imports FSL). |
| `src/app_run/` | 16 | ~5.6k | main + renderer | App run (dev server) actor, wire codecs (`docs/adr/app-run-wire-codecs.md`). |
| `src/app_wiring/` | 7 | ~0.9k | renderer | Wiring of app-level actors to UI. |
| `src/window_infrastructure/` | 29 | ~5.6k | main + renderer | Multi-window infrastructure, window security (`src/main/window_security.ts` companion). |
| `src/main/` | 30 | ~10.7k | main | Settings file I/O, safe-storage legacy recovery, deep-link queue, preview `WebContentsView` + **CDP broker** for Playwright-in-preview, protocol registration, updater state, session banner, window lifecycle policy, "pro" (subscription) return handling. |
| `src/lib/` | 99 | ~14.8k | mixed | Utilities: `schemas.ts` (Zod settings/app schemas), streaming patch application, chat-mode logic, telemetry wrappers, query keys, packaging cleanup, error types. |
| `src/utils/` | 23 | ~5k | mixed | Performance monitor, crash dumps/minidump summary, OOM classifier, misc. |
| `src/prompts/` | 23 | ~4.6k | main | System prompts: `system_prompt.ts` (XML-tag "build mode" prompt), `local_agent_prompt.ts`, `plan_mode_prompt.ts`, `compaction_system_prompt.ts`, `summarize_chat_system_prompt.ts`, `supabase_prompt.ts`, `neon_prompt*.ts`, `security_review_prompt.ts`, `test_assertions_prompt.ts`, `mcp_consent_policy.ts`, `inspiration_prompts.tsx`, `guides/*.md` (add-authentication, email verification, password reset) with framework filtering; snapshot tests. |
| `src/db/` | 3 | ~1k | main | Drizzle schema (`schema.ts`) + `index.ts` (open/migrate). |
| `src/shared/` | 43 | ~3.6k | shared | Cross-process shared modules (telemetry field builders, etc.). |
| `src/distributed_machines/` | 46 | ~22.5k | main + renderer | Remote-machine execution over SSH (actor host, transport, UI). |
| `src/coolify_setup/`, `src/coolify_deploy/` | 42 | ~12.3k | main + renderer | Coolify (self-hosted PaaS) provisioning and deployment flows. |
| `src/github_ops/` | 17 | ~4.6k | main + renderer | GitHub operations actor/projection (`useGithubOps` imports FSL). |
| `src/supabase_admin/`, `src/neon_admin/` | 22 | ~7.7k | main | Supabase and Neon OAuth return handlers, management-API clients, prompt context. |
| `src/mcp_oauth/` | 5 | ~1.2k | main | MCP server OAuth flows. |
| `src/version_preview/` | 16 | ~6.3k | main + renderer | Preview a historical version (git) of an app in a separate window. |
| `src/first_prompt/` | 13 | ~2.5k | main + renderer | "First prompt" flow: create app + first chat in one step. |
| `src/plan_handoff/` | 11 | ~1.6k | main + renderer | Plan-mode → build-mode handoff. |
| `src/user_input/` | 13 | ~3.2k | main + renderer | Agent-initiated user questions/follow-ups (`docs/user-input-follow-up-recovery.md`). |
| `src/preview_iframe/`, `src/preview_console/` | 14 | ~2.5k | renderer | Preview iframe controller and console buffer. |
| `src/screenshot/`, `src/image_generation/`, `src/voice_to_text/` | 29 | ~5.2k | mixed | Screenshot capture, image generation actor, voice input. |
| `src/connection_flow/` | 5 | ~1k | main | Generic OAuth "connection flow" runner (used by integrations). |
| `src/deep_link_window_readiness/` | 5 | ~0.3k | main | Queue deep links until a window can receive them. |
| `src/package_manager_warnings/` | 3 | ~0.2k | renderer | Warnings about pnpm/npm state. |
| `src/i18n/` | 34 | ~0.2k | renderer | i18next setup + locale JSON. |
| `src/testing/` | 22 | ~5.3k | test | Hybrid test harness (`hybrid.setup.ts`, fake engine/gateway routing). |
| `src/__tests__/` | 108 | ~16.7k | test | Cross-cutting tests + `evals/` (80 files: prompt/agent evaluation fixtures). |
| `src/contexts/`, `src/client_logic/`, `src/constants/`, `src/errors/`, `src/paths/`, `src/app/`, `src/data/`, `src/styles/` | 12 | ~1.2k | mixed | Small support modules; `src/paths/paths.ts` resolves userData (dev override `DYAD_DEV_USER_DATA_DIR`). |

---

## 4. `src/ipc/` — the main-process core

| Path | Files | Lines | Responsibility |
|------|------:|------:|----------------|
| `src/ipc/ipc_host.ts` | 1 | — | Registers every handler module at startup (`registerIpcHandlers`). Imports FSL. |
| `src/ipc/contracts/` | 2 | ~1.3k | IPC contract definitions (channel → input/output schema) and the invoke **envelope** (`isIpcInvokeEnvelope`, `unwrapIpcEnvelope`) used by preload. |
| `src/ipc/preload/` | 2 | ~0.3k | Channel allowlists derived from contracts (`VALID_INVOKE_CHANNELS` etc.). |
| `src/ipc/handlers/` | 179 | ~59.8k | One module per domain: apps, app blueprints, collections, env vars, upgrades, capacitor, chat, chat stream, chat mode resolution, turn acceptance, compaction, connection flows, context paths, coolify (+setup), custom apps folder, debug, dependencies, distributed machines, first prompt, free quotas, git branches, github, help bot, image generation, import, language models, local models (ollama, lmstudio), mcp, media, migrations, misc, native theme, neon, node, plans, portal, preview view, pro, problems, prompts, proposals, recording, release notes, security, session, settings, shell, supabase, templates, terminal, test assertions, testing chat, tests, token count, upload, user input, vercel, versions, version preview windows, window, window infrastructure. Plus `base.ts`, `safe_handle.ts`, `trusted_handle.ts`, `handler_context.ts`. |
| `src/ipc/services/` | 98 | ~27.4k | Long-lived services: app operation coordinator + mutation fences/locks, app deletion queue, app runtime service/transport/orchestration, chat actor service + deletion fences, git service + overlay workspace, GitHub ops, image generation, version preview, plan handoff, pre-commit, isolated package install, Codex subscription auth/usage, external model admission/billing, user budget, e2e test runtime/workspace/registry. |
| `src/ipc/processors/` | 18 | ~7.2k | `response_processor.ts` (applies `<dyad-*>` tags from the XML-mode LLM response: write/delete/rename files, add deps, SQL, etc.; imports FSL search/replace processor), streaming processors. |
| `src/ipc/utils/` | 226 | ~60.2k | Flat bag of 219 utility modules: `process_manager.ts` (dev-server processes), `git_utils.ts`, `mcp_manager.ts`, `get_model_client.ts` / `llm_engine_provider.ts` / provider option builders, `token_utils.ts`, `versioned_codebase_context.ts`, `ripgrep_utils.ts`, `pty_session_manager.ts`, `runShellCommand.ts` / `simpleSpawn.ts` / `spawn_streaming.ts` / `windows_command.ts`, `secret_storage.ts`, `telemetry.ts`, `start_proxy_server.ts`, `port_utils.ts`, `app_mutation_lock.ts`, Neon/Supabase/Vercel/Coolify clients, `sandbox/` (7 files: capabilities/path policy + `sandbox_worker.ts`). |
| `src/ipc/types/` | 53 | ~10.2k | Shared request/response types per domain (`index.ts` re-exports; imports FSL). |
| `src/ipc/shared/` | 7 | ~2.4k | Helpers shared by handlers. |
| `src/ipc/deep_link_data.ts`, `git_types.ts` | 2 | — | Deep-link payload schemas; git types. |

---

## 5. Observations that shape later phases

1. **No physical process boundary in source.** `src/` mixes main, renderer and shared code; the only separation is the IPC channel allowlist and discipline. Import-cycle and accidental-Node-in-renderer risks are policed by convention (`rules/electron-ipc.md`), not by package boundaries.
2. **`src/ipc/utils` is a 219-file flat namespace** (~60k lines) containing process management, git, providers, MCP, secrets, sandboxing and telemetry side by side — the primary coupling hotspot.
3. **The agent runtime is outside the open-source region.** Everything architecturally interesting about "how the AI edits code" is FSL; the Apache region contains the older XML-tag pipeline (`response_processor.ts`, `system_prompt.ts`) and the plumbing around the FSL loop.
4. **Two generations coexist:** XML-tag "build mode" (`<dyad-write>` etc., `docs/architecture.md`) and native tool-calling "agent v2" (`docs/agent_architecture.md`). Mode selection/fallback logic lives in `chat_mode_resolution.ts` and `rules/chat-modes.md`.
5. **Explicit state machines are a deliberate, in-progress migration** (`docs/why-state-machines.md`, `plans/*state-machines*.md`, `src/state_machines/`), i.e. the maintainers themselves identified boolean-state explosion as a problem.
6. **Generated apps are not fully portable at dev time:** the scaffold depends on `@dyad-sh/react-vite-component-tagger`, and previews receive injected scripts from `worker/`. Runtime production builds appear unaffected (UNVERIFIED — Phase 7).
7. **Heavy integration surface:** Supabase, Neon, Vercel, Coolify, GitHub, Capacitor, distributed SSH machines, Codex subscription, MCP, local models (Ollama, LM Studio), image generation, voice — each a handler + service + UI cluster.
