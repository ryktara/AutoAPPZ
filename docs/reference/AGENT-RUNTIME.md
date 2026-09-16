# AI Agent Runtime — `dyad-sh/dyad` @ `39064d24`

How a user request becomes model calls, tool calls, edits, validation and preview. The **tool loop implementation is FSL-restricted and was not read**; everything here is reconstructed from the Apache-licensed orchestration around it (`chat_stream_handlers.ts` 3.5k lines), prompts (`src/prompts/*`), contracts, schema, maintainer rules/docs, e2e fixtures and UI cards. FSL internals are marked `UNVERIFIED` where inferred.

---

## 1. Two generations

| | Generation 1 — "Build (XML)" | Generation 2 — "Local Agent v2" |
|---|---|---|
| Mechanism | Model emits `<dyad-write path=…>`, `<dyad-rename>`, `<dyad-delete>`, `<dyad-add-dependency>`, `<dyad-execute-sql>`, `<dyad-search-replace>`, `<dyad-copy>`, `<dyad-command>`, `<dyad-chat-summary>` in plain text; main parses with regex (`dyad_tag_parser.ts`) and applies after approval (`response_processor.ts`) | Native AI SDK tool calling (`streamText` + `tools`), multi-step loop until no tool call or step limit; tools execute during the stream; results rendered as XML cards |
| Context | Entire codebase (filtered) injected as a fake first user message "This is my codebase." + "OK, got it" assistant reply; optional engine-side smart context | No codebase injection; model reads on demand via tools; only file-count/size metadata computed |
| Status | "intentionally dormant" (every selectable mode routes to gen 2); code remains for stored-response migration and `approve-proposal` | Active for Build, Ask, Plan and Agent modes |
| Approval | Proposal card (files changed, packages, SQL) → Approve/Reject unless `autoApproveChanges`; destructive SQL never auto-applied | Per-tool consent (`ask\|always\|never`), SQL/MCP classifiers; edits apply immediately |

The maintainers' FAQ explains the original XML choice (parallel edits, JSON-code quality) and the cost rationale for a "simple agentic loop"; the codebase shows they since reversed that decision.

---

## 2. Request pipeline (Apache side)

```mermaid
sequenceDiagram
  autonumber
  participant R as Renderer (ChatInput / useStreamChat)
  participant A as Main: chat_stream actor (definition.ts)
  participant H as Main: chatStreamHandler
  participant DB as SQLite
  participant P as Prompt builder (system_prompt.ts / local_agent_prompt.ts)
  participant L as FSL: handleLocalAgentStream (tool loop)
  participant M as Model provider (AI SDK)
  participant FS as App folder / git / runtime
  R->>A: dispatch submit {chatId, prompt, attachments, selectedComponents, requestedChatMode, intentId}
  A->>H: executeChatStreamFromActor(observedSender, request)
  H->>H: schema safeParse; track stream; wait admission barriers (chat, app)
  H-->>R: chat:stream:start
  H->>DB: read chat+messages+app; resolve model/mode; reserve free-agent quota
  H->>FS: persist attachments to .dyad/media (+manifest, gitignore)
  H->>H: expand @prompt:, /skill, @media:, /implement-plan=, selected components
  H->>DB: acceptChatTurn (idempotent insert user msg; latch chat mode/model) under queue lock
  H-->>R: chat:response:chunk {effectiveChatMode}
  H->>DB: insert placeholder assistant msg (approvalState=approved, sourceCommitHash=HEAD)
  H-->>R: chat:response:chunk {messages}
  H->>FS: listCodebaseFileMetadata (size stats only)
  H->>P: constructSystemPrompt(mode, AI_RULES.md, theme, framework, DB provider, capability flags, blueprint state)
  H->>L: handleLocalAgentStream(systemPrompt, readOnly/planModeOnly/toolProfile, settings, model, referencedApps…)
  loop until no tool call / step limit / cancel
    L->>M: streamText(messages, tools)
    M-->>L: text deltas + tool calls
    L-->>R: chat:response:chunk {streamingPatch} (≥150ms) / full messages
    L->>FS: execute tool (read/write/grep/tsc/tests/git/sql/mcp…) after consent
    L-->>R: agent-tool:todos-update / problems-update / user-input:requested
  end
  L->>FS: git add + commit at end of writable turn
  L->>DB: update assistant msg content + aiMessagesJson + commitHash + maxTokensUsed
  H->>DB: extract <dyad-chat-summary> → chat.title; schedule FTS index
  H-->>R: chat:response:end {updatedFiles, chatSummary, warningMessages, pausePromptQueue?}
  H-->>R: chat:stream:end
  A->>A: settle intent; dispatch next queued intent (FIFO) or pause (stop/manual/step-limit/review)
```

---

## 3. System prompts and project instructions

| Piece | Source | Notes |
|---|---|---|
| Role/guidelines | `local_agent_prompt.ts` blocks: role, app commands (`<dyad-command type="refresh">`), app lifecycle rules (when to restart/reinstall), general guidelines (security, no partial implementations, simplicity rules), tool-calling rules (parallel calls, never name tools to user), git provenance block, tool-selection table (`search_replace` vs `write_file`), development workflow (Understand → Clarify → Plan → Implement → Verify → Finalize) with capability-dependent text | Pro vs Basic variants; Ask variant is read-only; Build variant has its own workflow |
| Project rules | `AI_RULES.md` at app root, inserted verbatim into `<ai_rules>`; default rules describe the React/Vite/shadcn stack; model may edit it only for durable conventions | Injected with a `$`-safe replacer to avoid `$&` splicing |
| Theme | `getThemePromptById(app.themeId)` appended | FSL themes handler |
| Framework | `detectFrameworkType` → Vite apps get a server-layer block (`enable_nitro` ordering rules); Next.js has built-in routes | — |
| Database | Supabase/Neon prompt blocks incl. RLS/JWT/no-service-role-in-browser rules; disconnected variants; local agent fetches schema via tools instead of injecting context | `supabase_prompt.ts`, `neon_prompt*.ts` |
| Blueprint gate | `<app_blueprint mode="required">` with explicit questionnaire → `write_app_blueprint` flow | `local_agent_prompt.ts:512-581` |
| Testing | Playwright test-writing guidance + `run_tests` fix loop with bounded attempts; recorded-test proposal flow | `system_prompt.ts:355-570` |
| Implementer sub-agent | separate focused prompt: assignment contract (GOAL / MUST HOLD / OUT OF SCOPE / DONE WHEN), provider invariants, root-only operations reported back | `constructImplementerPrompt` |
| Special intents | `/security-review` swaps to `SECURITY_REVIEW_SYSTEM_PROMPT` (+ `SECURITY_RULES.md`); `Summarize from chat-id=` uses summarization prompt; compaction uses `COMPACTION_SYSTEM_PROMPT` | — |
| Thinking | `THINKING_PROMPT` asks for `<think>` tags (legacy); reasoning deltas are wrapped as `<think>` with tag-escaping | — |

Prompt snapshot tests exist (`src/prompts/__snapshots__`), and e2e "server dump" snapshots assert the exact request bodies.

---

## 4. Context construction

| Mode | What the model gets |
|---|---|
| Agent/Build/Ask/Plan (gen 2) | System prompt (above) + chat history (`aiMessagesJson` structured tool history when present, else content with `<think>`/problem-report tags stripped; Ask strips all `<dyad-*>`), limited to `maxChatTurnsInContext` turns (+1), git provenance reminders appended to user messages, `<system-reminder>` naming valid `@app` references, attachments as image parts / inline text / on-disk paths depending on mode. **No repository contents up front.** |
| Legacy XML | `extractCodebase`: git-listed files (fallback: traversal + gitignore), allowlisted extensions, excluded dirs/files, 1 MB cap, `.env*` always omitted, low-signal files (`src/components/ui`, tsconfigs) content-omitted unless smart context; sorted by mtime (cache-friendly); per-app `chatContext` include/exclude globs; `@app:` mentioned apps appended read-only |
| Engine (Pro) | Files sent as provider options for server-side smart/deep context and lazy edits (`UNVERIFIED` server behavior) |

Compaction: token usage from provider `usage.totalTokens` (max, not sum) + estimated tool-result tokens; threshold `min(cap[provider], contextWindow − 25k)`; when reached the chat is marked `pendingCompaction`, a summary is generated (pinned fast model for Pro), pre-compaction messages are backed up (`compactionBackupPath`), and a compaction summary message is inserted. Mid-turn compaction inside the loop is described in rules (`UNVERIFIED` mechanics).

Token accounting: `estimateTokens = ceil(chars/4)`; context windows from the static model catalog (default 128k); `maxTokensUsed` persisted per assistant message; a token bar and context-limit banner in the UI; the proposal handler suggests "Summarize in new chat" at >80% or >10 messages.

---

## 5. Tool registry, schemas and permissions

- Registry: FSL `tool_definitions.ts` (`TOOL_DEFINITIONS`, `buildAgentToolSet`). Tools carry `modifiesState`, optional `allowInReadOnlyModes`, `defaultConsent`, consent metadata, `mutationTracking`, and are filtered by mode (`readOnly`, `planModeOnly`), profile (`build`), entitlement (Pro), settings consents (`never` removes the tool), and sub-agent allowlists. (`rules/local-agent-tools.md`)
- Observed tool names (from consents, prompts, UI cards, e2e): `read_file, list_files, grep, code_search, search_replace, write_file, copy_file, delete_file, rename_file, add_dependency, execute_sql, get_database_table_schema, get_supabase_project_info, get_neon_project_info, run_type_checks, run_tests, run_build, run_pre_commit, restart_app, reinstall_and_restart_app, read_logs, git, web_search, web_fetch, web_crawl, generate_image, read_guide, set_chat_summary, update_todos, spawn_agent, explore_code (legacy), explore_chat_history, search_chats, read_chat, execute_sandbox_script, search_mcp_tools, get_mcp_tool_schema, <mcp server tools>, add_integration, enable_nitro, write_app_blueprint, planning_questionnaire, write_plan, exit_plan, generate_test_assertions, engine_fetch (internal)`.
- Permission model: settings `agentToolConsents[tool] ∈ {ask, always, never}`; runtime consent via the `user_input` machine (`agent-consent` descriptor; decisions accept-once / accept-always / decline; 5-min deadline; cancellation resolves parks); MCP per-server-tool consent table `mcp_tool_consents` (`ask\|always\|denied`) with optional Pro classifier racing the prompt; SQL auto-approval only for provably non-destructive statements (`autoApproveNonSchemaSql`); global `autoApproveChanges` for legacy proposals; `blockUnsafeNpmPackages` routes installs through the Socket firewall.
- Path safety: tools resolve paths with `safeJoin` + realpath containment (`assertMutationPathAllowed`), refuse project root, deny `.git`, `node_modules`, dotfiles with secrets, redact `.env` values on read; sandbox scripts get a stricter host-call policy.

---

## 6. Modes

| Mode | Prompt | Tools | Persistence | Quota |
|---|---|---|---|---|
| **Agent** (`local-agent`) | full | all (Pro) / basic set (free) | writes + commit | free quota for non-Pro |
| **Build** | build variant (no sub-agents/logs/verification/sandbox/MCP) | "fail-closed app-building profile" | writes + commit | none |
| **Ask** | read-only variant | read tools only | none | none |
| **Plan** | plan prompt | read tools + questionnaire/write_plan/exit_plan | `.dyad/plans/*.md` | none |

Default resolution: explicit non-agent default honored; Pro → Agent; Google-only keys → Build; otherwise Agent. Free-Pro model constraints can force a compatible mode. Mode is latched per chat on first accepted turn.

---

## 7. Streaming, cancellation, retries, recovery

- **Streaming:** AI SDK `fullStream`; text deltas accumulate into `fullResponse`; `cleanFullResponse` may rewrite earlier bytes so patches are LCP-based; DB save throttled to 150 ms; renderer reconstructs `slice(0, offset) + content`.
- **Cancellation:** `chat:cancel` → abort controllers, clear pending consent parks, immediate `chat:response:end {wasCancelled}`, then await handler unwind (`streamCompletions`) so restores/deletes never race in-flight writes; partial content persisted with a cancellation notice; actor marks intent terminal `cancelled`.
- **Retries (gen 1):** `maxRetries: 2` at SDK level; ≤2 search/replace repair rounds (re-read then rewrite with `dyad-write`); ≤2 continuation rounds for unclosed `<dyad-write>`.
- **Retries (gen 2, per rules):** transient/5xx/rate-limit classification with backoff racing the abort signal; replay utilities to re-send after failures; Anthropic tool_use/tool_result sanitization; refusal handling as terminal (`UNVERIFIED` exact policy).
- **Step limit:** `maxToolCallSteps` setting; hitting it pauses the queue with reason `step-limit` and shows a "step limit" card with continue.
- **Crash recovery:** durable `chat_turn_intents` + queue rows hydrate paused; sub-agent threads marked `interrupted_by_restart`; no automatic resumption.
- **Queue:** per-chat FIFO of queued messages with revisioned edits/reorder; review barriers (auto-review) can pause it.

---

## 8. File edits, diffs, shell, packages, DB, deploy, MCP

| Capability | Gen 2 behavior (observed) |
|---|---|
| Edits | `search_replace` (line-based unique match, loud failure, "fallback to write_file after 2 failures") and `write_file`; paths validated; mutation activity tracked per turn/actor for pre-commit and test-retry gating; **no changed-since-read/hash check** (`UNVERIFIED`) |
| Diffs | Rendered per message ("Modified files" card) from `sourceCommitHash..commitHash`; version diff view via git |
| Shell | No general shell tool for the model. Verification commands are fixed tools (`run_type_checks` → app-local tsc; `run_tests` → Playwright in isolated workspace; `run_build` → isolated worktree build with deadlines and attempt limits; `run_pre_commit` → repo hooks). Sandbox scripts run in mustardscript with read-only host functions (+ gated `write_file`). |
| Packages | `add_dependency` → `executeAddDependency` validates npm spec grammar (registry names only, no tarballs/URLs), runs `pnpm add`/`npm install` via PTY runner with timeout, optionally through Socket firewall (`npx sfw`), records denied build scripts in `pnpm-workspace.yaml`; result appended as `<dyad-output>` |
| Database | `execute_sql` routed to Neon (branch) or Supabase (management API); destructive statements require consent; Supabase migration file optionally written; schema tool renders replayable DDL via `ts-pg-schema-diff` model |
| Deployment | Not an agent tool; user-driven via panels (Vercel/Coolify); agent may call `add_integration` to start OAuth |
| MCP | Servers from DB (stdio/http), tools namespaced `server__tool`, results sanitized for size, consent per tool, `search_mcp_tools`/`get_mcp_tool_schema` for discovery when `enableMcpToolSearch` |
| Sub-agents | `spawn_agent(persona)`: explorer (compiler-backed code exploration, "starting map" report), implementer (writable, scoped assignment, own consent binding, must be joined before commit), reviewer (review latest turn's commit range; auto-fix countdown; findings → fix). Threads/messages/activities persisted; cancellation drains actor generations. |
| Checkpoints / undo | Every writable turn commits; undo via version revert (new commit) or restore-to-message (fork chat); `[Interrupted]` checkpoint preserves partial writes |
| Status reporting | `set_chat_summary` (title), `update_todos` (todo list card + reminders for incomplete todos), problem reports, lifecycle events (`agent-lifecycle-started/succeeded/failed`), sub-agent team card, token bar |

---

## 9. Model provider abstraction and selection

- `getModelClient(model, settings, selection, {chatId, autoModelCandidates, externalModelAdmission})` returns `{modelClient: {model, builtinProviderId, reasoningEffortProviderId}, isEngineEnabled, isSmartContextEnabled}`.
- Providers via AI SDK factories: OpenAI (chat + Responses API), Anthropic, Google, Vertex (service account JSON), Azure (OpenAI-compatible or Azure SDK), xAI, Bedrock, OpenRouter (OpenAI-compatible), Ollama (custom provider), LM Studio (OpenAI-compatible), MiniMax, custom OpenAI-compatible providers from DB, vendor engine (`llm_engine_provider.ts`: OpenAI-compatible/Responses/Anthropic models proxied through the vendor gateway with request IDs and provider options for smart context/lazy edits), ChatGPT subscription adapter.
- `auto` provider: vendor-side routing ("auto", "auto-balanced"); with free-tier fallbacks via OpenRouter.
- Per-model options: `temperature`, `maxOutputTokens`, `contextWindow`, effort levels (reasoning) from the static catalog + user effort preferences; provider options built centrally (`provider_options.ts`).
- Local models: Ollama/LM Studio discovery lists; no capability metadata beyond names (`UNVERIFIED` context windows for local models → default 128k).
- Billing/admission: subscription preflight, external model admission, user budget (`get-user-budget`), free quotas.

---

## 10. Sequence diagram — complete app generation (new app)

```mermaid
sequenceDiagram
  participant U as User
  participant UI as Renderer
  participant M as Main
  participant AI as Model
  participant FS as App folder + git
  participant RT as Runtime (pnpm/vite) + proxy
  U->>UI: "Build a restaurant app" (Home)
  UI->>M: create-app → create-chat → submit intent
  M->>FS: copy React scaffold, git init, commit "Init"
  M->>AI: system prompt (blueprint gate) + prompt
  AI->>M: planning_questionnaire(questions)
  M-->>UI: user-input:requested (questionnaire card)
  U->>UI: answers
  UI->>M: user-input:respond
  M->>AI: tool result
  AI->>M: write_app_blueprint(name, design, color, visuals)
  M-->>UI: app-blueprint:update (card); turn ends
  U->>UI: Approve
  UI->>M: app-blueprint:approve → rename app/folder, needsAppBlueprint=false, follow-up message
  M->>AI: "The app blueprint has been approved…"
  loop tool loop
    AI->>M: list_files / read_file / write_file / add_dependency / update_todos
    M->>FS: apply edits (path-checked), pnpm add
    M-->>UI: streaming cards
  end
  AI->>M: run_type_checks
  M->>FS: tsc --noEmit (scheduled utility process)
  M->>AI: diagnostics
  AI->>M: search_replace fixes…
  M->>FS: git add/commit; assistant msg commitHash
  M-->>UI: chat:response:end {updatedFiles:true}
  UI->>M: run-app (preview panel)
  M->>RT: pnpm install && pnpm run dev --port 32100+n
  RT-->>M: stdout "http://localhost:32100"
  M->>RT: start proxy 42100+n (inject shim)
  M-->>UI: app:output [dyad-proxy-server]started
  UI->>RT: iframe loads proxy URL
  RT-->>UI: postMessage window-error (if any)
  U->>UI: "Fix error with AI"
  UI->>M: submit intent (error text)
  M->>AI: … fix loop … commit
```

---

## 11. Gaps and unverified points

- `UNVERIFIED`: exact step limit defaults, retry classification, compaction-in-loop mechanics, tool schemas, consent metadata per tool, subagent model routing (prompts mention pinned models per persona for Pro).
- The **blueprint** is not persisted (in-memory Map keyed by chatId); an app restart between questionnaire and approval loses it (the prompt handles "questionnaire already completed" via message history).
- There is no explicit acceptance-criteria/requirements artifact; "done" is defined by the model's own verification steps and the user's review.
- No structured diagnostics feedback contract: tool outputs are text blobs (bounded) rendered as XML cards; type-check results are the one structured report (`ProblemReport`).
