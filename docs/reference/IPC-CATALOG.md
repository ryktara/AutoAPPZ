# IPC Catalog — `dyad-sh/dyad` @ `39064d24`

383 channels are declared across `src/ipc/types/*.ts` (invoke, send, event and stream channels) plus 5 test-only invoke channels. All are allowlisted in preload by derivation from contracts; dynamic `terminal:data:*` / `terminal:exit:*` receive channels are allowlisted by prefix.

Validation legend: **Z** = Zod input validation via `createTypedHandler` (+ output validation in dev only); **L** = `createLoggedHandler` legacy handler, **no schema validation**, args logged at debug level; **R** = raw `registerTrustedIpcHandler`; **S** = one-way `ipcMain.on` send with manual `parse`. All invoke handlers pass the trusted-renderer check (`senderFrame === mainFrame` + URL allowlist). Direction: **→** renderer→main invoke, **⇢** renderer→main fire-and-forget, **←** main→renderer event.

Errors: handlers throw `DyadError(kind)`; envelope serializes `{name,message,kind,code,stack}`; renderer rethrows. Non-classified errors are reported to telemetry.

---

## 1. Catalog by domain

### 1.1 Settings & subscription (`settings.ts` → `settings_handlers.ts`)
| Channel | Dir | Val | Input → Output | Side effects | Security notes |
|---|---|---|---|---|---|
| `get-user-settings` | → | Z | void → `UserSettings` | reads + decrypts secrets; merges remote config (`blockUnsafeNpmPackages`) | **Returns decrypted secrets to renderer** (API keys, OAuth tokens) |
| `set-user-settings` | → | Z | `Partial<UserSettings>` → `UserSettings` | shallow merge, re-encrypt, atomic write with `.bak` | shallow merge foot-gun documented |
| `validate-provider-api-key` | → | Z | `{provider, apiKey,…}` → validation result | outbound HTTPS to provider | key transits renderer→main |
| `codex-subscription:status/connect/disconnect/acknowledge` | → | Z | — | OAuth to ChatGPT subscription (Codex) | tokens in settings |

### 1.2 Apps (`app.ts` → `app_handlers.ts`, `import_handlers.ts`, `custom_apps_folder_handlers.ts`)
| Channel | Dir | Val | Side effects | Security / concurrency |
|---|---|---|---|---|
| `create-app` | → | Z | DB insert apps+chats, template copy/clone, git init+commit | name uniqueness; folder slug; first-prompt registry |
| `copy-app` | → | Z | copy dir (excl. node_modules, optional .git), DB insert, git init | coordinator `copy-app` (read app-path, runtime-config), refuse when recording |
| `get-app` | → | Z | recursive file listing, Supabase/Vercel name lookups | external calls on load (caught) |
| `list-apps` | → | Z | DB read | — |
| `delete-app` / `delete-apps` | → | Z | full deletion fence, stop process, DB delete cascade, rm -rf, Neon/Supabase test cleanup | heaviest orchestration in codebase |
| `rename-app` | → | Z | stop app, move dir (case-hop aware), DB update, rollback | rejects absolute paths; validates folder name; coordinator w/ `app-path, repository, runtime` |
| `change-app-location` | → | Z | copy dir to new absolute parent, DB update | absolute path from native dialog |
| `preview-app-folder-name` | → | Z | none | — |
| `run-app` / `stop-app` / `restart-app` | → | Z | dispatch to `app_run` actor; ends recordings; ensures off test branch | `invocationRef` correlation; restart with `removeNodeModules`/`recreateSandbox` |
| `edit-app-file` | → | Z | write file, git stage, Neon timestamp, Supabase function deploy, cloud sync | `safeJoin`; **no changed-since-read check** |
| `read-app-file` | → | Z | bounded read | `safeJoin`, size bound |
| `search-app-files` | → | Z | spawns ripgrep (`--json --fixed-strings`) | args array, cwd=app |
| `search-app` | → | **L** | SQL LIKE across apps/chats/messages | param escaped |
| `respond-to-app-input` | → | Z | writes `y\|n` to child stdin | validated to y/n |
| `get-cloud-sandbox-status` / `create-cloud-sandbox-share-link` | → | Z | vendor API | Pro |
| `rename-branch` | → | Z | `git branch -m` | coordinator |
| `add-to-favorite` / `set-testing-enabled` / `update-app-commands` | → | Z | DB update | `metadata` claim |
| `select-app-location` / `select-custom-apps-folder` / `select-node-folder` / `select-app-folder` | → | L/Z | native open dialog | — |
| `select-app-for-preview` | → | Z | GC protection bookkeeping | — |
| `app:get-current-commit-hash` / `app:save-screenshot` / `app:list-screenshots` / `app:list-thumbnails` | → | Z | writes `.dyad/screenshots/<hash>.png` (≤5 MB data URL, prune to N) | data-URL regex validated |
| `import-app` / `check-app-name` / `check-ai-rules` | → | **L** | copy or in-place import, git init, DB insert | in-place stores absolute path |
| `get-custom-apps-folder` / `set-custom-apps-folder` | → | Z | settings write, cache invalidation | — |

### 1.3 Chat (`chat.ts` → `chat_handlers.ts`, `chat_stream_handlers.ts`, `dependency_handlers.ts`, `token_count_handlers.ts`)
| Channel | Dir | Val | Notes |
|---|---|---|---|
| `create-chat` | → | Z | accepts number (legacy) or object; first-prompt registry tracking |
| `get-chat` / `get-chats` / `get-chat-metadata` / `search-chats` | → | Z | `get-chat` projects renderer-safe columns (excludes `aiMessagesJson`); FTS5 search |
| `update-chat` / `set-chat-favorite` / `delete-chat` / `delete-messages` / `remove-chat-referenced-app` | → | Z | destructive ops drain streams first (`mutateChatAfterDrainingStreams`) |
| `chat:stream` | → (stream) | Z (manual `safeParse`) | **test-only registration in production** (`registerLegacyChatStreamTestHandler` throws outside Vitest); production path is the `distributed-machine:dispatch` actor → `executeChatStreamFromActor` |
| `chat:response:chunk` / `chat:response:end` / `chat:response:error` | ← | Zod on receive | chunk: full messages or tail patch; end: `updatedFiles, extraFiles, warningMessages, chatSummary, wasCancelled, pausePromptQueue…` |
| `chat:stream:start` / `chat:stream:end` | ← | — | transport lifecycle |
| `chat:response:ack` | → | Z | flow-control ack (test streaming) |
| `chat:cancel` | → | Z | aborts controllers, resolves consent parks, awaits unwind |
| `chat:count-tokens` | → | Z | estimates tokens (chars/4) incl. codebase |
| `chat:observe-submission-stop-policy` | → | Z | actor read |
| `chat:add-dep` | → | **L** | finds message containing `<dyad-add-dependency>` and runs install |

### 1.4 Agent & sub-agents (`agent.ts` → FSL `agent_tool_handlers.ts`)
| Channel | Dir | Notes |
|---|---|---|
| `agent-tool:get-tools` / `agent-tool:set-consent` | → | tool list + per-tool consent (`ask\|always\|never`) in settings |
| `agent-tool:todos-update` / `agent-tool:problems-update` | ← | todo list and problem report projections |
| `agent:list-subagents` / `get-subagent-messages` / `get-subagent-activities` / `send-subagent-message` / `followup-subagent` / `start-review` / `run-auto-review-barrier` / `fix-review-findings` / `skip-review-auto-fix` / `cancel-subagent` | → | sub-agent threads (`agent_threads`) |
| `agent:subagent-update` | ← | thread snapshots |

### 1.5 User input / consent (`user_input.ts` → `user_input_handlers.ts`)
`user-input:get-pending`, `user-input:respond`, `user-input:reject-follow-up` (→); `user-input:requested/armed/classified/settled/follow-up-due` (←). One machine serves agent-tool consent, MCP consent, questionnaires, integration prompts, test-assertion review. Deadlines 5/30 min.

### 1.6 Git / GitHub (`github.ts` → `github_handlers.ts`, `git_branch_handlers.ts`)
| Channel | Dir | Val | Notes |
|---|---|---|---|
| `git:get-uncommitted-files` / `git:get-uncommitted-file-diff` / `git:commit-changes` / `git:cancel-commit` / `git:discard-changes` | → | Z | commit runs hooks with progress `git:commit-progress` (←); dotenv values redacted in diffs |
| `github:list-repos` / `get-repo-branches` / `is-repo-available` / `list-local-branches` / `list-remote-branches` / `list-collaborators` / `invite-collaborator` / `remove-collaborator` / `clone-repo-from-url` | → | Z | GitHub REST with stored token; clone limited to github.com HTTPS |
| GitHub ops actor (create repo, connect, push, rebase, disconnect) | via `distributed-machine:*` | — | main-owned `github_ops` machine |

### 1.7 Connection flows / OAuth (`connection_flow.ts`)
`connection-flow:start/cancel/acknowledge/get-states` (→), `connection-flow:state-changed/unsolicited-return` (←). Generic OAuth runner for GitHub device flow, Supabase, Neon, vendor Pro, ChatGPT; deep links complete flows.

### 1.8 MCP (`mcp.ts` → `mcp_handlers.ts`)
`mcp:list-servers/list-catalog/add-from-catalog/create-server/update-server/delete-server/list-tools/get-tool-consents/set-tool-consent/start-oauth/probe-callback-port/probe-connection/disconnect-oauth/is-oauth-storage-encrypted`. Creating a server stores `command`, `args[]`, encrypted env/headers, URL, OAuth config. **Any command the renderer passes becomes a spawned stdio process** when the server is enabled (user-initiated; no allowlist).

### 1.9 Providers / models (`language-model.ts` → `language_model_handlers.ts`, `local_model_*`)
`get-language-model-providers`, `get-language-models`, `get-language-models-by-providers`, `create/edit/delete-custom-language-model-provider`, `create/update/delete-custom-language-model`, `delete-custom-model`, `local-models:list-ollama`, `local-models:list-lmstudio`. Mostly **L** (legacy) handlers.

### 1.10 Versions (`version.ts` → `version_handlers.ts`, `version_preview_window_interest_handlers.ts`)
`list-versions`, `get-version-changes`, `set-version-favorite`, `set-version-note`, `get-current-branch` (→, Z); revert/checkout/restore-to-message run through the `version_preview` actor (`version-preview:acquire/release/restore-window-interest`, `version-preview:result` ←). All mutation cores take coordinator claims and refuse during recording.

### 1.11 Database integrations (`supabase.ts`, `neon.ts`, `migration.ts`)
Supabase: `list-organizations`, `delete-organization`, `list-all-projects`, `create-project`, `list-branches`, `get-edge-logs`, `set-app-project`, `unset-app-project`, `detect-legacy-app-key`, `switch-app-to-publishable-key`, `redeploy-all-functions` (+`redeploy-progress` ←), `fake-connect-and-set-project` (test). Neon: `create-project`, `get-project`, `list-projects`, `set-app-project`, `unset-app-project`, `set-active-branch`, `get-email-password-config`, `update-email-verification`, `get-branch-env-vars`, `set-selected-database-branch-type`, `fake-connect` (test). Several Neon handlers use `createLockedHandler` (coordinator-wrapped). `migration:migrate/preview` (portal).

### 1.12 Deployment (`vercel.ts`, `coolify.ts`, `coolify_setup.ts`, `capacitor.ts`)
Vercel: `save-token`, `list-projects`, `is-project-available`, `create-project`, `connect-existing-project`, `get-deployments`, `disconnect`, `get-sync-preview`, `sync-neon-config`, `remove-neon-env-vars`. Coolify: `get-status`, `save-token`, `discover`, `save-connection`, `check-domain`, `deploy`, `get-deploy-snapshot`, `clear-token`, `create-project`, `disconnect`, `deploy-status` (←); setup: `get-server-key`, `inspect`, `run`, `reveal-credentials`, `snapshot`, `accept-insecure-token`, `dismiss`, `cancel`, `changed` (←). Capacitor: `is-capacitor`, `sync-capacitor`, `open-ios`, `open-android`.

### 1.13 System (`system.ts` → `node_handlers.ts`, `shell_handler.ts`, `window_handlers.ts`, `debug_handlers.ts`, `upload_handlers.ts`, `session_handlers.ts`, `release_note_handlers.ts`, `pro_handlers.ts`, `native_theme_handlers.ts`)
| Channel | Val | Notes |
|---|---|---|
| `nodejs-status`, `get-node-path`, `install-managed-node`, `cancel-managed-node-install`, `remove-managed-node`, `install-pnpm`, `reload-env-path`, `managed-node:install-progress` (←) | Z/R | downloads and installs a Node runtime into userData (managed); `install-pnpm` runs `npm i -g pnpm@latest-11` |
| `open-external-url` | **L** | http(s) only; `shell.openExternal` |
| `show-item-in-folder` | **L** | **any path** → `shell.showItemInFolder` |
| `open-file-path` | **L** | restricted to `.dyad/media` + media extension allowlist |
| `get-system-debug-info`, `get-session-debug-bundle` (misc), `clear-session-data`, `reset-all`, `restart-dyad`, `force-close-detected` (←) | Z | `reset-all` deletes DB, settings, all app folders |
| `get-app-version`, `does-release-note-exist`, `get-initial-load-telemetry-context`, `telemetry:event` (←), `get-system-platform`, `native-theme:get-state/updated` | Z | — |
| `get-user-budget`, `get-subscription-status`, `open-billing-action`, `upload-to-signed-url`, `cancel-upload`, `take-screenshot`, `discard-screenshot`, `recopy-screenshot` | Z | vendor cloud; screenshot upload for bug reports |
| `window:minimize/maximize/close/focus` | Z | — |

### 1.14 Misc (`misc.ts` → `app_env_vars_handlers.ts`, `problems_handlers.ts`, `portal_handlers.ts`, `app_handlers.ts`)
`get-env-vars` (**R**, returns provider env vars incl. secrets), `get-app-env-vars`/`set-app-env-vars` (Z, edits `.env`), `check-problems` (Z, runs tsc), `add-log`/`clear-logs` (Z), `portal:migrate-create`, `renderer:error-toast-ready`, `app:output`/`app:output-batch` (←), `chat:stream:start/end` (←), `deep-link-received` (←), `toast:error`/`toast:dismiss` (←), `stable` (misc event).

### 1.15 Templates, themes, prompts, media, collections, plans, blueprints, security, upgrades, context, proposals, help, audio, image generation, recording, tests, terminal, preview view, window infrastructure, distributed machines, free quotas, first prompt
- Templates/themes (`templates.ts`, FSL `themes_handlers.ts` for themes): `get-templates`, `apply-app-template`, `get-themes`, `set/get-app-theme`, custom themes CRUD, `generate-theme-prompt`, `generate-theme-from-url` (web crawl), `save-theme-image`, `cleanup-theme-images`, `get-theme-generation-model-options`.
- Prompts library: `prompts:list/create/update/delete`. Media: `list-all-media`, `rename/delete/move/open-media-file`. Collections: `appCollections:list/create/update/delete/assignApps`.
- Plans: `plan:create/get/get-for-chat/update/update-plan/delete/exit/handoff-presentation` (+ `planEvents` ←). Blueprint: `app-blueprint:approve/edit-field/edit-visual/add-visual/remove-visual` (→), `update/visuals-update/approved/timeout` (←).
- Security: `get-latest-security-review`, `get-or-create-security-fix-chat`. Upgrades: `get-app-upgrades`, `execute-app-upgrade` (e.g. pnpm migration, component tagger). Context: `get-context-paths`/`set-context-paths` (glob include/exclude per app). Proposals (legacy XML): `get-proposal`/`approve-proposal`/`reject-proposal` (**L**). Help: `help:chat:start/cancel` stream. Audio: `pro:transcribe-audio`. Image generation: `image-generation:wait-for-operation` + `presentation` (←). Recording: `recording:start/stop/save-draft/discard-draft` + events. Tests: `tests:list/run/stop/apply-assertions/discard-assertions/screenshot/delete/detect-legacy/migrate-legacy` + `tests:output/run-state` (←). Terminal: `terminal:open/close/kill/write/resize/serialize` + dynamic data/exit events. Preview view (native `WebContentsView`): `preview-view:show/hide/go-back/go-forward/reload` (→), `set-bounds`/`set-overlay-active` (⇢ send), `navigation-state/load-failed/screenshot-updated` (←). Window infrastructure: `window-infrastructure:bootstrap/open-entity-in-new-window/begin|adopt|reject|acknowledge-chat-tab-transfer/confirm-source-chat-tab-removal/focus-chat/set-focused/set-visible-entities/set-chat-tab-ownership/attach-interest/detach-interest` + `window:query-invalidations/entity-disposed/chat-tab-transfer-remove-source/navigate-to-chat` (←). Distributed machines: `distributed-machine:subscribe/dispatch/unsubscribe` (→), `snapshot/disposed/operation-outcome/protocol-mismatch` (←) — the generic actor transport (256 KiB envelope cap). Free quotas: `free-agent-quota:get-status`, `free-model-quota:get-status`. First prompt: `first-prompt:commit-creation`/`cancel-creation` (⇢ send).
- Test-only invoke channels always allowlisted: `test:simulateQuotaTimeElapsed`, `test:set-node-mock`, `test:set-needs-app-blueprint`, `test:get-app-process-id`, `test:set-neon-auth-fixture` (handlers registered only in e2e builds).

---

## 2. Findings

### 2.1 Overly broad or under-validated APIs
| Finding | Evidence | Impact |
|---|---|---|
| `get-user-settings` returns **all decrypted secrets** to the renderer on every read (API keys, GitHub/Vercel/Supabase/Neon/Coolify tokens, Coolify admin password). | `settings_handlers.ts`, comment in `lib/schemas.ts` ("reaches the renderer whenever settings are read") | Any renderer compromise (XSS via markdown/model output, malicious preview escaping the iframe) exfiltrates all credentials. |
| `get-env-vars` (raw handler) returns provider API keys from the process environment to the renderer. | `app_handlers.ts:1243-1255` | Same as above. |
| ~20 legacy `createLoggedHandler` channels have **no input schema** (`search-app`, `import-app`, `check-app-name`, `check-ai-rules`, `open-external-url`, `show-item-in-folder`, `open-file-path`, `chat:add-dep`, proposals, most language-model CRUD, `select-app-location`). Args are `any[]` and are **logged at debug level** (including tokens if passed). | `safe_handle.ts` | Type confusion, path injection (`show-item-in-folder` accepts any path), log leakage. |
| Output validation only in development. | `base.ts` | Handlers can leak main-only columns in production (rule acknowledges this). |
| `mcp:create-server` accepts arbitrary `command`/`args`/env to spawn. | `mcp_handlers.ts:274-328` | Intentional (user-configured), but it makes the renderer a path to arbitrary process execution with the user's privileges. |
| Renderer receives absolute file paths in many payloads (`attachments`, `resolvedPath`, media URLs, error messages). | e.g. `<dyad-attachment path=…>`, `getApp().resolvedPath` | Information disclosure of local paths to model prompts/telemetry; minor. |

### 2.2 Duplicated handlers / duplicated logic
- `createTypedHandler` and `createLoggedTypedHandler` are copy-pasted bodies (`base.ts`).
- `check-app-name` exists in both `app.ts` (Z) and `import.ts` (L) contracts.
- Version mutation cores are exposed both as legacy handlers and via the `version_preview` actor bridge during migration.
- Chat-mode/model compatibility logic is intentionally mirrored renderer/main.

### 2.3 Hidden side effects
- `edit-app-file` deploys Supabase edge functions and stores Neon timestamps as part of a "save".
- `get-app` performs network calls (Supabase project name, Vercel team slug) on every load.
- `run-app` ends recordings and may rewrite `.env.local` (test-branch restore) before starting.
- `create-app` may clone from GitHub and hit the GitHub API.
- `set-user-settings` re-encrypts every secret on every write; stale-read races overwrite concurrent changes (documented).
- `select-app-for-preview` influences process GC.

### 2.4 Authorization boundaries
- Single trust domain: any code in the trusted renderer can call any channel; there is no per-window or per-app capability scoping (multi-window ADR acknowledges "request/correlation IDs are identifiers, not capabilities").
- App-scoped checks exist inside handlers (e.g. `restore-to-message` verifies `chat.appId === appId`), but not uniformly.
- Preview content is isolated (separate origin/`WebContentsView`, sandboxed popups, `authBootstrapToken` for credentials).

### 2.5 Concurrency, locking and races
- Per-app coordinator is solid but **queues without timeout**; recording sessions can hold claims 30 min; every new handler must remember to declare resources (convention-enforced).
- Explicitly documented races accepted: dependency install vs chat checkpoint (lockfile may land in any commit), `pnpm-workspace.yaml` stale-read overwrite, TOCTOU in delete path revalidation, `reset-all` TOCTOU.
- Module-level maps (`runningApps`, `activeStreams`, `admissionPendingStreams`, `appBlueprintStore`, `codebaseTokenCache`) are process-global singletons with hand-written invariants ("Do NOT introduce an `await` between…").
- Renderer/IPC ordering: invoke replies and events are unordered (documented; mitigations ad hoc).

### 2.6 Long-running work in inappropriate places
- Type checks run the app-local `tsc` CLI in a child process **serialized through a single scheduler** with code exploration; a long tsc blocks code exploration and vice versa.
- Code explorer builds a full `ts.Program` in a utility process (2 GB cache budget) — heavy but correctly off-main-thread.
- `extractCodebase` (legacy path) reads the entire repository into main-process memory (1 MB/file cap, 500-entry cache) — dormant for agent modes.
- Git operations are child processes but many are awaited sequentially on the main thread's event loop (e.g. per-file `gitAdd` in the response processor).
- `get-version-changes` spawns up to 2 git processes per changed file (bounded to 10 concurrent).
- Sync `fs` calls remain in main-process hot paths (`response_processor.ts` uses `fs.writeFileSync`, `fs.rmdirSync`; `app_handlers.ts` `getFilesRecursively`).
