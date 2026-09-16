# Product Reverse Engineering — `dyad-sh/dyad` @ `39064d24`

This document describes **what the reference product does**, traced through UI → state → IPC → service → persistence/runtime → provider → error path → tests. It describes; it does not judge (judgement is in `UX-ANALYSIS.md`, `TECHNICAL-DEBT.md` and the design docs).

Legal boundary: agent-tool *implementations* live in the FSL region and were not read. Every statement about tool behavior below is derived from Apache-licensed call sites (`chat_stream_handlers.ts`, prompts, contracts, handlers), the maintainers' own docs/rules, e2e specs and fake-LLM fixtures. Items that could not be confirmed from those sources are marked `UNVERIFIED`.

---

## 1. Product model in one paragraph

The reference is a local Electron desktop application in which a user describes an app in natural language; the app keeps a **SQLite catalog of "apps" (folders under `~/dyad-apps/`, each a git repository) and "chats"**, sends the prompt plus project context to an LLM through a provider abstraction, lets the model **edit the folder through a tool loop**, **commits every AI turn to git** (a "version"), runs the folder's dev server as a child process behind a **local reverse proxy**, and shows it in an **iframe preview** that reports runtime errors back so the user can ask the AI to fix them. Optional integrations attach a hosted database (Supabase/Neon), a GitHub remote, a deployment target (Vercel/Coolify), MCP servers, and a vendor cloud ("Pro"/"Engine") that unlocks smart context, sub-agents, and cloud sandboxes.

---

## 2. Product lifecycle (end to end)

```
install → launch → onboarding → provider setup → create app → prompt
→ (blueprint) → planning → generation (tool loop) → file edits (committed)
→ dependency install + dev server → proxy → preview → error captured
→ "Fix error with AI" → validation (type check) → database link → auth guide
→ GitHub push → deploy (Vercel/Coolify) → reopen later (catalog + git)
```

| Stage | What actually happens | Evidence |
|-------|------------------------|----------|
| **Install** | Signed installers per platform (Squirrel exe, macOS zip, deb/rpm/AppImage). Custom protocol `dyad://` is registered for OAuth returns. | `forge.config.ts`, `main.ts` `setAsDefaultProtocolClient` |
| **Launch** | `main_bootstrap.ts` (Squirrel guard) → `main.ts` `onReady()`: claim crash sentinel `session.lock`; `BackupManager` (backs up settings + DB on version upgrade, keeps 3); `initializeDatabase()` (open SQLite WAL, run Drizzle migrations; fatal dialog + quit on failure); fire-and-forget reconciliation of interrupted sub-agents, stale build snapshots, orphan Neon test branches / Supabase test users / e2e workspaces; cleanup of old AI message JSON and media; scrub GitHub tokens from git remotes; encrypt legacy plaintext MCP secrets; `git safe.directory`; crash detection from sentinel; GPU/crash-reporter params; performance monitor (30 s snapshots); `dyad-media://` protocol handler; managed Node runtime selection; first-run hook; create window; menu; auto-update (`update-electron-app`, 60-min interval, `api.dyad.sh/v1/update/{stable\|beta}`). | `src/main.ts:417-660` |
| **Onboarding** | Home page shows a prompt box, inspiration prompts, "Import App", featured showcase, telemetry consent banner. If no provider is configured, submitting the first prompt opens the **AI setup dialog** ("Start free Pro trial", "ChatGPT subscription", "OpenRouter", "Other providers", "Already have Pro? Add your key"). The pending prompt is **parked** and auto-resumes once a key is saved. Google-only keys switch the default mode to Build; OpenRouter switches the pending prompt to Basic Agent. | `e2e-tests/setup_flow.spec.ts`, `SetupBanner.tsx`, `first_prompt/*` |
| **Provider setup** | Settings → Providers/`$provider` route. API keys are validated (`validate-provider-api-key`) then stored in `user-settings.json` encrypted with `safeStorage`. Env vars (`OPENAI_API_KEY` etc.) are also honored (`get-env-vars`). Local providers: Ollama (`OLLAMA_HOST`), LM Studio; custom OpenAI-compatible providers/models live in SQLite (`language_model_providers`, `language_models`). | `settings_handlers.ts`, `main/settings.ts`, `language_model_handlers.ts`, `lib/schemas.ts` |
| **Create app** | `create-app`: sanitize display name (unique), slugify folder (auto-suffix), insert `apps` row (`needsAppBlueprint` from settings), insert first `chats` row, copy template (bundled React scaffold or cached GitHub clone of `next`/`react-vite-nitro`/`portal-mini-store`), `.dyad/` gitignored, `git init` + initial commit, store `initialCommitHash` on the chat. A "first prompt saga" makes creation + first chat + first stream atomic with cancellation tombstones if the renderer dies mid-way. | `app_handlers.ts:838-958`, `createFromTemplate.ts`, `first_prompt_creation_service.ts` |
| **Prompt** | Renderer dispatches a **typed intent to the main-owned chat-stream actor** (`ChatStreamRemoteManager.ensure(chatId).send({type:"submit"})`), never `chat:stream` directly. Main runs admission barriers, resolves mode/model, reserves free-agent quota, persists the user message idempotently (`chatTurnIntentId`), latches the chat's first mode/model, then streams. | `rules/electron-ipc.md`, `chat_stream_handlers.ts:1013-1800` |
| **Blueprint** (new apps) | When `enableAppBlueprint` and `apps.needsAppBlueprint`, the prompt forces a gate: model must call `planning_questionnaire` (1–5 product questions), then `write_app_blueprint` (name, template, theme, design direction, primary color, visual assets w/ image prompts). User reviews an editable card; **Approve** flips `needsAppBlueprint=false`, may rename the app/folder (auto-suffix), and the system sends a follow-up message with the approved blueprint to start implementation. Blueprint state is **in-memory per chat**, not persisted. | `local_agent_prompt.ts` blueprint block, `app_blueprint_handlers.ts`, `e2e-tests/local_agent_basic.spec.ts` |
| **Planning** | **Plan mode**: read-only tools + `planning_questionnaire`, `write_plan`, `exit_plan`. Plan is saved as `.dyad/plans/chat-<id>-plan.md` with frontmatter (`status: draft\|accepted`). User annotates text selections with comments ("Send Comments"). Accepting creates a new chat with `/implement-plan=<slug>`, which is expanded server-side into "Please implement the following plan…". | `plan_mode_prompt.ts`, `plan_handlers.ts`, `planPersistence.ts`, `e2e-tests/plan_mode.spec.ts`, `chat_stream_handlers.ts:1472-1506` |
| **Generation** | All four modes now run through the **native tool-calling loop** (`handleLocalAgentStream`, FSL): Build = "fail-closed app-building tool profile" (no sub-agents, engine tools, logs, verification commands, sandbox, MCP); Ask = read-only; Plan = plan tools only; Agent = full. The legacy `<dyad-write>` XML path is present but "intentionally dormant". Loop stops at `maxToolCallSteps` (settings) or when the model stops calling tools. Streaming goes to the renderer as tail-diff patches every ≥150 ms; the placeholder assistant message is saved to SQLite as it streams. | `chat_stream_handlers.ts:2713-2889`, `docs/agent_architecture.md` |
| **File editing** | Tools (names observed in prompts/consents/UI cards): `read_file`, `list_files`, `grep`, `code_search`, `search_replace` (line-based, fails loudly if not unique), `write_file`, `copy_file`, `delete_file`, `rename_file`, `add_dependency`, `execute_sql`, `run_type_checks`, `run_tests`, `run_build`, `run_pre_commit`, `restart_app`, `reinstall_and_restart_app`, `read_logs`, `git`, `web_search/fetch/crawl`, `generate_image`, `read_guide`, `set_chat_summary`, `update_todos`, `spawn_agent` (explorer/implementer), `explore_chat_history`, `search_chats`, `read_chat`, `execute_sandbox_script`, MCP tools, `add_integration`, `enable_nitro`, `write_app_blueprint`, `planning_questionnaire`, `write_plan`, `exit_plan`, `generate_test_assertions`. Each rendered as a `<dyad-*>` XML card in the transcript. Writable turns **commit at the end of the turn**; the assistant message stores `sourceCommitHash` (before) and `commitHash` (after). | `src/components/chat/Dyad*.tsx`, `rules/local-agent-tools.md`, `messages` schema |
| **Dependency install + dev server** | `run-app` → `appRunActorService.dispatchStart` → `AppRuntimeService.start` → `cleanPort` (kill-port) → spawn **one shell command** `pnpm --config.pm-on-fail=ignore … install && pnpm rebuild … && pnpm run dev --port <32100+id%10000>` (npm fallback: `npm install --legacy-peer-deps && npm run dev -- --port`) with `shell:true`, cwd=app; or custom `installCommand && startCommand`. Docker mode wraps it in `node:22-alpine`; Cloud mode uploads files to a vendor sandbox. Wait up to 2 min for readiness. | `app_runtime_service.ts:160-330, 513-648` |
| **Proxy + preview** | stdout is scanned for `https?://localhost:\d+`; on first match a `worker_threads` **reverse proxy** starts on `42100+id%10000` (fallback band 52100–52149) that injects `dyad-shim.js`, error/stack-trace capture, console forwarding, component selector, visual editor, screenshot, recorder, auth bootstrap and a service worker into HTML responses. The iframe loads the proxy URL (stable origin per app so localStorage/cookies survive restarts). Output is batched to the renderer (`app:output-batch`) and mirrored into an in-memory 1000-entry log store per app. Idle apps not selected for 10 min are garbage-collected (unless `previewIdleTimeoutPolicy: never`). | `start_proxy_server.ts`, `worker/proxy_server.js`, `process_manager.ts`, `shared/ports.ts` |
| **Error detection** | The shim posts `window-error`, `unhandled-rejection`, `iframe-sourcemapped-error`, `build-error-report` (Vite overlay detection via MutationObserver), navigation events to the parent; the renderer's `preview_iframe` state machine stores a `PreviewError` and shows the **error banner** with "Fix error with AI" / "Fix All Errors". stderr from the dev server also becomes console entries. | `worker/dyad-shim.js`, `PreviewErrorBanner.tsx`, `e2e-tests/fix_error.spec.ts` |
| **AI correction** | "Fix error with AI" submits a synthesized prompt containing the captured error into the current chat (same tool loop). The **Problems** panel runs the app-local `tsc --noEmit --incremental --project tsconfig.app.json` (scheduled in a serialized utility process), lists diagnostics, and offers "Fix All"/"Fix selected" which submit `<dyad-problem-report>`-style prompts. Auto-fix on every turn was removed ("Problems checks are manual-only"). | `problems_handlers.ts`, `processors/tsc.ts`, `e2e-tests/problems.spec.ts`, `lib/schemas.ts` (deprecated `enableAutoFixProblems`) |
| **Database** | The agent proposes `add_integration`; user picks Supabase or Neon via OAuth (`dyad://*-oauth-return`). Supabase: org credentials, project pick/create, edge functions deployed on every server-function write, SQL via management API, optional migration files. Neon: project + `development`/`preview`/`production` branches, `POSTGRES_URL` written into `.env.local`, **DB timestamp captured at each version** for time-travel restore, throwaway branches for tests. Prompts inject provider rules; `get_database_table_schema` reads live schema. | `supabase_handlers.ts`, `neon_handlers.ts`, `response_processor.ts:258-339`, `version_handlers.ts:686-813` |
| **Authentication (generated app)** | Guides `add-authentication.md`, `add-email-verification.md`, `add-password-reset.md` are read via `read_guide` (mandatory before writing Neon Auth code per prompt rules). | `src/prompts/guides/*` |
| **Git** | Every applied turn = a commit. Version pane lists `git log` (depth 100k) merged with `versions` metadata (favorite, note, Neon timestamp). Undo = `revert-version` (stage-to-revert + new commit, never history rewrite); "Restore to message" forks a new chat at that commit. Uncommitted-files banner, commit dialog (with pre-commit/commit-msg hooks), discard, branch list/rename/create, merge-conflict resolution "with AI". | `version_handlers.ts`, `git_service.ts`, `github.ts` contracts |
| **GitHub** | Device-flow OAuth; token in settings (encrypted); create/connect repo; push; rebase-from-remote with abort/continue; collaborators; clone-from-URL import. Tokens are injected per git invocation via `GIT_CONFIG_*` env, never in remote URLs. | `github_handlers.ts`, `AGENTS.md` |
| **Deployment** | Vercel: token → list/create/connect project → deployments list; Neon env-var sync to Vercel. Coolify (self-hosted, experimental, behind `enableOwnServerDeployment`): server setup wizard over SSH, deploy keys, deploy + status. Capacitor: iOS/Android project sync/open. | `vercel_handlers.ts`, `coolify_*`, `capacitor_handlers.ts` |
| **Reopen** | Apps list from SQLite (newest first, favorites, collections, thumbnails from `.dyad/screenshots/`). Opening an app loads files recursively (`get-app`), framework type, Supabase/Vercel names; chats list per app; the runtime is not auto-started — the preview panel starts it when the app is selected (`select-app-for-preview` + run). | `app_handlers.ts:1142-1213`, `pages/app-details.tsx` |

---

## 3. Main user journeys

Legend for each row: **Trigger → UI → States → Backend → Persisted → Failure → Retry → Security**.

### 3.1 First launch

- **Trigger:** first process start (`hasRunBefore=false` written as `true` by `onFirstRunMaybe`).
- **UI:** Home page; telemetry consent banner (`telemetryConsent: unset`); macOS "move to Applications" prompt; release-notes dialog on version change.
- **States:** settings defaults (`DEFAULT_SETTINGS`: model `auto/auto`, mode `build`, blueprint on, auto-update on, stable channel, managed Node off).
- **Backend:** creates `user-settings.json`, `sqlite.db`, `~/dyad-apps/`.
- **Persisted:** settings file, DB, `session.lock`.
- **Failure:** DB migration failure → modal error and quit. Unreadable settings → defaults + error toast with restore docs link; the unreadable file is kept as `.recovery-*.bak`.
- **Retry:** relaunch.
- **Security:** telemetry off until consent; secrets not yet present.

### 3.2 First application

- **Trigger:** prompt typed on Home + Send/Enter.
- **UI:** if no provider: AI setup dialog; else navigates to `/chat?id=…` with streaming; blueprint questionnaire card → blueprint card → Approve.
- **States:** `firstPromptSaga` (renderer) with `firstPromptCreationOperationId`; main `FirstPromptCreationRegistry` (track/complete/commit/cancel with tombstones).
- **Backend:** `create-app` → `create-chat` → chat actor `submit`.
- **Persisted:** `apps`, `chats` (initialCommitHash), template files, git repo with "Init Dyad app" commit, `.dyad/` folder.
- **Failure:** name conflict → Conflict error (user picks another); inaccessible custom folder → error; if the renderer dies before commit, main deletes the half-created app.
- **Retry:** parked prompt survives provider setup and re-submits automatically.
- **Security:** template GitHub clone restricted to `https://github.com/org/repo`, cached under `userData/templates`, freshness checked via GitHub API HEAD SHA.

### 3.3 Opening an existing project / reopen

- **Trigger:** click app in sidebar/list.
- **UI:** app details / chat with preview panel; file tree (`get-app` returns every file path), code view (Monaco) with save → **staged** (not committed) → Commit menu.
- **Backend:** `get-app`, `get-chats`, `select-app-for-preview`, `run-app` (if preview visible), `list-versions`.
- **Failure:** app folder missing → files empty, error logged; git missing → versions `[]`.
- **Security:** `read-app-file` uses `safeJoin` + bounded read; `edit-app-file` uses `safeJoin` and stages via git.

### 3.4 Importing a repository

- **Trigger:** Home → Import App → pick folder (native dialog).
- **UI:** Import dialog checks `AI_RULES.md` presence (offers to generate), name conflicts, custom install/start commands, "import in place" option.
- **Backend:** `import-app`: copy (deterministic order) or `skipCopy` (absolute path stored), `git init` + initial commit if not a repo, insert `apps` (no blueprint) + first chat.
- **Failure:** source missing → NotFound; name exists → Conflict.
- **Security:** in-place import means the app path can be anywhere on disk; all later path checks are relative to that root.

### 3.5 Chatting with AI (all modes)

- **Trigger:** message submit in chat; supports attachments (files/images, "upload to codebase" vs "chat context"), `@app:Name` references (sticky per chat), `@prompt:id` library prompts, `/slug` skills, `@media:` mentions, selected components (from the preview component selector), redo.
- **UI:** streaming markdown with `<dyad-*>` cards; queued messages list; token bar; context-limit banner; cancellation banner; consent banners (agent tool / MCP / SQL) rendered from the main-owned `user_input` machine; questionnaire input; todo list.
- **States (main):** chat-stream host machine (`admitting → streaming → finalizing`), per-chat queue (`chat_queue_states/entries`, paused reasons `stop\|manual\|step-limit`), `chat_turn_intents` acceptance/recovery.
- **Backend:** admission barriers (per app/chat), mode+model resolution, quota reservation, attachment persistence to `.dyad/media` (+ manifest), prompt expansion, system prompt construction (AI_RULES.md, theme, framework, DB provider, capabilities), tool loop, end-of-turn commit, title extraction (`set_chat_summary`), FTS indexing.
- **Persisted:** `messages` (content XML, `aiMessagesJson` structured history, `maxTokensUsed`, `model`, hashes), `chats.title/modelSelection/chatMode`.
- **Failure:** provider errors → `chat:response:error` with request ID (Pro); model refusal → warning persisted; quota exceeded → typed error with reset time; validation errors → DyadError; tool errors → inline `<dyad-output type="error">`.
- **Retry:** stream retries on transient/5xx/rate-limit (classified in FSL handler, per rules); search-replace fix loop ≤2; continuation on unclosed write ≤2; user "Keep going"/redo.
- **Security:** attachments size-checked; `.env*` redacted from tool reads; secrets never in prompts (settings hold them encrypted); AI_RULES.md inserted with `$`-safe replacer.

### 3.6 Planning

Covered in §2 (Plan mode). Persisted plan file in the app (`.dyad/plans/`, gitignored). Annotations are renderer-side until sent. Handoff to implementation is a **main-owned durable protocol actor** (`plan_handoff`) with idempotency keys.

### 3.7 Generating vs modifying existing code

Same loop. Differences: for new apps the blueprint gate precedes implementation; for existing apps the prompt's Understand step directs `spawn_agent(explorer)` (Pro) or `grep/list_files/read_file`; edits prefer `search_replace` over `write_file` when <½ of the file changes.

### 3.8 Previewing

- **Trigger:** app selected with preview panel open, or Run/Restart/Rebuild buttons, or agent tools `restart_app`/`reinstall_and_restart_app`.
- **UI:** preview toolbar (address path, back/forward/reload, device size toggles, screenshot, component selector, annotator (Pro), visual editing (Pro), "More" → Clear cache), loading screen while waiting for logs, error banner, console/network/logs panels, terminal (node-pty, up to 5 sessions per app).
- **States:** `app_run` machine: `idle → starting → ready → reloading/stopped/errored` with `invocationRef` correlation; `RunningAppInfo` in `runningApps` map.
- **Backend:** see §2 Dependency install + Proxy.
- **Persisted:** nothing except logs in memory; `apps.installCommand/startCommand`.
- **Failure:** spawn failure → detailed error; ready timeout 2 min; port conflicts → proxy fallback band; pnpm "ignored builds" → self-heal (record in `pnpm-workspace.yaml`, delete `node_modules`, reinstall once); Docker missing → error; cloud errors mapped to user messages.
- **Retry:** Restart/Rebuild; GC restarts on next selection.
- **Security:** proxy binds `localhost`; auth bootstrap token must be echoed by the trusted renderer; popups from previews are re-created sandboxed without preload; `will-navigate` blocks main-window navigation.

### 3.9 Fixing errors

Covered in §2. Two entry points: runtime error banner (from shim events) and Problems panel (tsc). Both create ordinary chat turns; no special agent state.

### 3.10 Viewing files / inspecting diffs

- File tree + Monaco editor (`read-app-file` bounded), unsaved-files queue, staged diff view (`git:get-uncommitted-file-diff`), version diff view (`get-version-changes`: per-file old/new content with 1 MB and binary guards, 10-way concurrency), "Modified files" card per assistant message.

### 3.11 Using the terminal

`terminal:open/write/resize/close/kill/serialize` → node-pty session in app cwd with the user's login shell env (`shell-env`), scrollback 2 MB/10k lines, ≤5 live sessions, exited sessions reaped after 10 min. Output is delivered on dynamic channels `terminal:data:<sessionId>` (allowlisted by prefix in preload).

### 3.12 Configuring API providers / local models

- Providers: `openai, anthropic, google, vertex, auto (vendor), openrouter, ollama, lmstudio, azure, xai, bedrock, minimax` + custom (DB). Per-provider extra fields (Azure resource name, Vertex project/location/service-account JSON). "Dynamic models" fetched from provider APIs for some providers (`e2e-tests/dynamic_models*.spec.ts`).
- Local: `local-models:list-ollama`, `local-models:list-lmstudio`.
- Model picker persists `selectedModel` + per-model `modelEffortPreferences` (reasoning effort), `recentModels`.
- Failure: key validation errors surfaced inline; env-var-only providers detected via `get-env-vars`.

### 3.13 Secrets / environment variables

- Platform secrets: `user-settings.json` fields encrypted via `safeStorage` (`electron-safe-storage`) with `plaintext` fallback when no keyring; MCP env/headers in SQLite encrypted columns; legacy macOS keychain identity recovery.
- App env: `get-app-env-vars` / `set-app-env-vars` edit `.env`/`.env.local`; `.env*` contents are excluded from codebase context and redacted from tool reads.

### 3.14 GitHub workflow, commits, branches

See §2 rows. Commit dialog runs `pre-commit`, `prepare-commit-msg`, `commit-msg` hooks as explicit phases with progress events and cancellation; failures are classified with stable `GIT_ERROR_CODES`; "Fix pre-commit with AI" exists.

### 3.15 Database connection / schema migration / Supabase / Neon

See §2. Additional: `migration:migrate/preview` (portal migration), `supabase:switch-app-to-publishable-key`, legacy-key detection banner, Supabase local mode (CLI-detected, `UNVERIFIED` exact flow), `enableSupabaseWriteSqlMigration` writes `supabase/migrations/*.sql` only for schema-mutating SQL that executed successfully; destructive SQL is never auto-applied.

### 3.16 Deployment

See §2. Vercel `detectFramework` maps the app to a Vercel framework preset; `vercel:sync-neon-config` copies Neon env vars/trusted domains; deployments polled via API.

### 3.17 Recovery from failed generations

- Cancel: aborts stream, persists partial response + "cancelled" notice, renderer notified immediately, handler unwinds (writes settle) before restore/delete can proceed.
- Crash mid-turn: `chat_turn_intents.recovery` marks interrupted; queued intents hydrate paused; no auto-run.
- Undo: revert-version / restore-to-message; if the target turn was cancelled, the dirty tree is first committed as `[Interrupted] Saved partial changes…` so nothing is lost.
- Sub-agents interrupted by restart → status `interrupted_by_restart` reconciled at startup.

### 3.18 Project deletion

`delete-app`: coordinator deletion fence → end recording/tests → drain admitted work → block streams/chat creation/sub-agents → cancel streams → stop process → delete Supabase test user → delete DB row (cascade chats/messages) → dispose actors → kill PTYs → `rm -rf` with retries (Windows locks) → clean Neon test branch (best effort, loud logging). Bulk delete runs per-app in parallel.

### 3.19 Application settings

Settings page (searchable) + provider pages. Notable toggles: default chat mode, auto-approve changes, auto-approve non-schema SQL, auto-approve safe MCP tools, agent tool consents (per tool ask/always/never), sub-agent toggles (explorer/implementer/advanced/auto-review), max tool-call steps, max chat turns in context, context compaction, runtime mode (host/docker/cloud), Node runtime (system/managed/custom path), custom apps folder, release channel, auto-update, telemetry, zoom, language (9), preview idle policy, block unsafe npm packages (Socket firewall), pnpm release-age warning, testing for new apps, sandboxed e2e tests, multi-window (experimental), cloud sandbox (experimental).

---

## 4. Significant states worth naming

| Entity | States | Where |
|--------|--------|-------|
| Chat turn intent | `queued → message-accepted → rejected`; recovery `not-started → started → terminal`; terminal outcomes incl. `cancelled` | `chat_turn_intents` |
| Chat queue | `revision`, `paused` (`stop\|manual\|step-limit`), entries `queued\|claimed` | `chat_queue_states/entries` |
| App run | `idle, starting, ready, reloading, stopped, errored` (+ `pendingUrl` buffer) | `docs/adr/app-run-wire-codecs.md` |
| Sub-agent thread | `queued, running, stopping, waiting_for_writer, auto_fix_countdown, fixing_findings, completed, partial, review_outdated, cancelled, entitlement_revoked, interrupted_by_restart, failed` | `agent_threads` |
| User input request | `awaiting → armed → due` with deadlines (5 min consent, 30 min integration/review); decisions `accept-once\|accept-always\|decline` | `user_input/registry.ts` |
| Message approval | `approved\|rejected\|null` (legacy XML proposals) | `messages.approvalState` |
| Plan | `draft\|accepted` | `.dyad/plans/*.md` frontmatter |
| Blueprint | in-memory `{…, approved}` per chat; app flag `needsAppBlueprint` | `app_blueprint_handlers.ts` |
| Terminal session | live (≤5) → exited (reaped 10 min) | `pty_session_manager.ts` |
| Version preview window | detached checkout + Neon preview branch; `return` restores | `version_preview/*` |

---

## 5. What is only available with the vendor cloud ("Pro"/"Engine")

Observed gates (Apache side): `isDyadProEnabled` (requires `providerSettings.auto.apiKey`) unlocks the engine gateway model routing, smart/deep context, Turbo edits v2 (search/replace via engine), explorer/implementer/reviewer sub-agents, `explore_chat_history`, web search, image generation, cloud sandboxes, annotator/visual editing, pinned compaction model, MCP auto-consent classifier, and free-quota bypass. Non-Pro "Basic Agent" has a metered free quota (`free_agent_quota`) and a reduced tool set (no `code_search`, web tools). This matters for AutoAPPZ because several "intelligent" behaviors are **server-side in the vendor engine** and are not visible in the repository at all (`UNVERIFIED` internals: smart-context file selection, lazy-edit expansion, consent classifier, web search).

---

## 6. Cross-cutting behaviors

- **Idempotency:** turn acceptance keyed by `chatTurnIntentId`/`userInputRequestId` with unique indexes; replays return the accepted message without a new model turn.
- **Concurrency:** `appOperationCoordinator` resource claims (`app-path, chat-content, chat-membership, media, metadata, provider, repository(-ref/-worktree), runtime, runtime-config, test-files`) with read/write modes, atomic multi-resource acquisition, no timeout, recording sessions holding claims up to 30 min with explicit refusals.
- **Multi-window:** experimental; main-owned actors publish revisioned snapshots; query invalidation bus fans out to all windows.
- **Telemetry:** PostHog via renderer; main sends events to first window; `DyadError` kinds filtered; non-Pro sampling 10%; crash minidump summaries; app-size and performance snapshots.
- **i18n:** en, zh-CN, ja, ko, es, fr, de, pt-BR, tr.

---

## 7. Unverified items

- `UNVERIFIED` Community templates API endpoint/shape (`ApiTemplate` type exists; fetch site not traced).
- `UNVERIFIED` Local Supabase (CLI) mode exact detection/switching flow.
- `UNVERIFIED` Exact tool schemas, consent metadata, `modifiesState` flags, step limits and retry classifications (FSL region; described only from prompts/rules).
- `UNVERIFIED` Engine-side smart context / lazy edits behavior (remote service).
- `UNVERIFIED` Help bot backend (`help:chat:*` stream) — likely vendor API.
