# Failure and Technical Debt Audit — `dyad-sh/dyad` @ `39064d24`

Evidence-based. Counts exclude `src/pro/**` and test files unless stated.

---

## 1. Marker counts (non-test, non-FSL `src/`)

| Marker | Count | Notes |
|---|---:|---|
| `TODO` | 17 | e.g. legacy `isRunning` crash migration, `// TODO: Handle add dependency tags` |
| `FIXME` / `HACK` / `XXX` | 0 | — |
| `deprecated` | 18 | settings fields, chat mode `agent`, thinking budget, native git flag |
| `workaround` | 7 | Windows ordering, keychain, Coolify token minting |
| `temporary` | 91 | mostly legitimate ("temporary branch/file"), some transitional code |
| `@ts-ignore` | 13 | asset imports, MakerSquirrel types, electron-squirrel-startup |
| `@ts-expect-error` | 1 | zod v4 inference in `registerTypedHandlers` |
| `eslint-disable` | 10 | — |
| `: any` | 195 | concentrated in IPC plumbing (`createLoggedHandler` args), test seams, error handling |
| `as any` | 52 | DB proxy, Electron typings |
| `as unknown as` | 26 | actor bridges (`undefined as unknown as IpcMainInvokeEvent`) |
| `catch {` | 277 | many swallow-and-continue paths (logged) |
| `process.env.` | 135 | env-driven behavior scattered across modules |
| `new Map<` | 274 | ad-hoc registries; ~30 module-level exported singletons |

`tsconfig.app.json` has `noUnusedLocals/Parameters: false`; `tsconfig.node.json` is not `strict`. `noUncheckedIndexedAccess` is off.

## 2. Findings by category

### 2.1 Architecture
| Finding | Evidence | Impact |
|---|---|---|
| Single `src/` tree for main, preload, renderer; boundaries by convention | `tsconfig.app.json`, `rules/electron-ipc.md` | Accidental cross-process imports; renderer bundles can pull main-only modules until Vite fails; FSL types leak into the renderer client |
| Flat `src/ipc/utils` (219 modules) mixing process management, git, providers, MCP, sandbox, telemetry | `REPOSITORY-MAP.md §4` | No ownership boundaries; import graph cycles (`utils → main/settings → lib/schemas → pro`) |
| Dual agent generations kept alive (XML tags + native tools); "dormant" legacy path still in the hot handler | `chat_stream_handlers.ts:2035-2038, 2891-3093` | 3.5k-line handler; migration debt for stored responses; every prompt still teaches `<dyad-command>` tags |
| Two coexisting concurrency styles (module-level maps + actor machines) | `activeStreams`, `admissionPendingStreams` vs `chat_stream/definition.ts` | Hand-written invariants ("Do NOT introduce an `await`…") |
| Integration columns on `apps` (20 nullable provider columns) | `db/schema.ts` | Schema grows per integration; null semantics differ per consumer |
| Vendor-cloud gating spread across prompts/handlers/settings/UI (`isDyadProEnabled` used in >30 places) | grep | Core behaviors depend on entitlement checks; hard to reason about the free path |
| Three runtime modes inside one service with mode branches | `app_runtime_service.ts` | Divergent behavior (comment: "lifecycle tool semantics must stay consistent across host, Docker, cloud") |

### 2.2 Reliability
| Finding | Evidence |
|---|---|
| Readiness via stdout regex; 2-minute poll; no health probe | `app_runtime_service.ts:804-822, 1970-1994` |
| `kill-port` kills whatever owns the app port | `killProcessOnPort` |
| Accepted races: install vs checkpoint; `pnpm-workspace.yaml` stale write; delete TOCTOU; reset TOCTOU | `getAppRuntimeOperationResources` comment; `response_processor.ts:395-399`; `resetAll` |
| Coordinator queue has **no timeout**; long-lived sessions require every handler to opt into refusal | `rules/app-operation-coordination.md` |
| Settings shallow-merge and stale-read overwrite | `rules/electron-ipc.md` "Settings write safety" |
| Invoke reply vs event ordering not guaranteed; mitigated per feature | rules |
| Blueprint state in memory; lost on restart | `app_blueprint_handlers.ts` |
| Sync `fs` in main hot paths (`writeFileSync`, `rmdirSync`, `getFilesRecursively`) | `response_processor.ts`, `app_handlers.ts` |
| Electron lifecycle async cleanup requires `preventDefault` + timeouts + re-entry guards (documented pitfalls) | rules |

### 2.3 Security
See `SECURITY-REVIEW.md §11` (S1–S10): secrets to renderer, unvalidated legacy handlers, args logging, no CSP, foreign process kills, tokens in deep links, plaintext fallback.

### 2.4 Performance
| Finding | Evidence |
|---|---|
| Single serialized lane for tsc + code explorer + supabase analysis | `typescript_utility_process_scheduler.ts` |
| Code explorer rebuilds whole `ts.Program`; in-memory only; 2 GB cache budget | `code_explorer_worker.ts` |
| Legacy `extractCodebase` loads entire repo into memory (1 MB/file cap) | `utils/codebase.ts` |
| Token estimation is `chars/4`; context windows from a static table | `token_utils.ts`, `language_model_constants.ts` |
| Streaming DB writes every 150 ms per stream; `cleanFullResponse` on every chunk (O(n) per chunk over full response) | `chat_stream_handlers.ts:2680-2711, 967` |
| `get-app` returns every file path on each load; recursive sync walk | `app_handlers.ts:1156` |
| Version diff loads full contents for every changed file (bounded 1 MB each) | `version_handlers.ts:970-1042` |
| Renderer: 1.8k-line `ChatInput`, 1.9k-line `ChatTabs`, 1.8k-line `PreviewIframe` re-render risk (React Compiler mitigates) | `TECHNICAL-DEBT.md §3` |

### 2.5 Maintainability
| Finding | Evidence |
|---|---|
| 12 source files >1,500 lines; `chat_stream_handlers.ts` 3,483; `git_utils.ts` 3,189; `tests_handlers.ts` 3,178; `app_handlers.ts` 2,706 | line counts |
| 19 React components >800 lines | line counts |
| Copy-pasted handler wrappers (`createTypedHandler` vs `createLoggedTypedHandler`) | `base.ts` |
| Rules directory is a 30-file, ~1,700-line list of "gotchas" — knowledge that should be types/tests | `rules/*.md` |
| Duplicated mode/model compatibility logic renderer/main by design | rules |
| Vendor branding hard-coded throughout identifiers (`dyad*`), tags, protocol, folder names | everywhere |
| 91 plan documents (many AI-generated) as design history | `plans/` |

### 2.6 UX
See `UX-ANALYSIS.md §9`. Debt items: ten preview modes; three places for the same integration; Build mode kept for legacy constraints; ~60 settings toggles.

### 2.7 Testing
See `TESTING.md §3`: no coverage measurement; agent e2e skipped on Windows; no Linux e2e; injected preview scripts untested; no migration-upgrade tests; brittle ARIA/request snapshots.

### 2.8 Developer experience
| Finding | Evidence |
|---|---|
| Custom toolchain constraints: must use `npm run ts` (tsgo) not `tsc`; oxlint not eslint (eslint still installed); worktree `node_modules` pitfalls; native rebuild failures documented at length | `AGENTS.md` |
| e2e requires packaged build (`npm run build`) and fake servers; slow local loop | `CONTRIBUTING.md` |
| Snapshot regeneration rituals (`--update-snapshots`, grep for old tool descriptions) | rules |
| Privileged-author CI matrix (self-hosted runners) | `ci.yml` |

## 3. Largest files (non-test, non-FSL)

`chat_stream_handlers.ts` 3483 · `git_utils.ts` 3189 · `tests_handlers.ts` 3178 · `app_handlers.ts` 2706 · `TestsPanel.tsx` 2177 · `app_runtime_service.ts` 2035 · `distributed_machines/actor_host.ts` 2025 · `version_handlers.ts` 1974 · `remote_transport.ts` 1935 · `ChatTabs.tsx` 1892 · `ChatInput.tsx` 1835 · `PreviewIframe.tsx` 1782 · `main.ts` 1776 · `playwright_bootstrap.ts` 1766 · `hybrid_chat_harness.tsx` 1727 · `ModelPicker.tsx` 1725 · `useTestRecorder.ts` 1531 · `supabase_management_client.ts` 1516 · `git_overlay_workspace.ts` 1454 · `github_handlers.ts` 1423.

## 4. Global state and singletons

30 exported module-level singletons (`runningApps`, `db` proxy, `appRuntimeService`, `appRunActorService`, `gitService`, `githubOpsService`, `queryInvalidationBus`, `entityDisposalBus`, `windowRegistry`, `remoteMachineHost`, registries, replay events…) plus non-exported maps (`activeStreams`, `admittedStreams`, `admissionPendingStreams`, `streamCompletions`, `partialResponses`, `appBlueprintStore`, `codebaseTokenCache`, `fileContentCache`, `executionObservers`). Test seams exist (`setDatabaseForTesting`, `setHandlerContextForTesting`) but most singletons are reached by direct import.

## 5. Process spawning and shell execution sites (non-test)

`spawn`/`exec` usage is concentrated in: `app_runtime_service.ts` (dev server, docker), `process_manager.ts` (docker stop/volume rm), `app_handlers.ts` (ripgrep), `git_utils.ts`/`buffered_process.ts` (git via dugite), `pty_command_runner.ts`/`pty_session_manager.ts` (node-pty), `socket_firewall.ts` (pnpm/npm/npx), `node_handlers.ts` & `managed_node.ts` (node/pnpm installs), `processors/tsc.ts` (tsc CLI), `code_explorer.ts` & `supabase_dependency_analysis.ts` (utilityProcess), `playwright_bootstrap.ts`/`tests_handlers.ts` (playwright), `runShellCommand.ts`/`simpleSpawn.ts`/`spawn_streaming.ts` (generic), `ssh_client.ts` (remote), `linux_protocol_registration.ts` (xdg). Only the dev server uses `shell: true`; others use argument arrays (Windows `.cmd` handling via `windows_command.ts`).

## 6. Retries and timeouts (selected)

| Where | Policy |
|---|---|
| AI SDK `streamText` | `maxRetries: 2` |
| Search/replace repair (gen 1) | ≤2 attempts; continuation ≤2 |
| Process kill | 5 s SIGTERM wait; SIGKILL escalation with bounded wait |
| App ready | 120 s poll @100 ms |
| GC | 60 s interval, 10 min idle |
| Git fingerprint | 30 s, 16 MB path bytes, 10k untracked paths |
| Pre-commit / commit-msg hooks | timeouts (`PRE_COMMIT_TIMEOUT_MS`, `COMMIT_MESSAGE_HOOK_TIMEOUT_MS`) |
| Package install | PTY default timeout (`DEFAULT_PTY_COMMAND_TIMEOUT_MS`) |
| Socket firewall probe / package manager probe | 30 s |
| Allow-builds list fetch | 5 s, 1 h TTL |
| Engine fetch (FSL) | 5 min default |
| Consent | 5 min; integration/review 30 min |
| Test workspace install | 15 min |
| Code explorer idle | 5 min; crash loop window 60 s |
| Coordinator queue | **none** |
| `retryOnLocked` (Neon) | retry on lock errors |
| `retryWithRateLimit` | provider rate limits |
| `npm-ci-retry.sh` | CI installs |

## 7. Summary: top ten debts to avoid inheriting

1. No physical process/package boundaries.
2. Monolithic handlers and a flat utility namespace.
3. Two agent protocols and stored-response migration debt.
4. Hand-maintained concurrency invariants over module-level maps.
5. Secrets flowing to the renderer.
6. Stdout-regex readiness and port-killing runtime.
7. Integration-per-column schema and provider concepts leaking into prompts/UI.
8. Vendor-entitlement gating woven into core logic.
9. Snapshot-heavy, platform-skipped e2e as the main safety net for agent flows.
10. Rules-as-documentation instead of types/tests for critical invariants.
