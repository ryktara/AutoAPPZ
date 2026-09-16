# Reference License Audit — `dyad-sh/dyad`

**Status:** Complete for baseline commit. Re-audit required if the reference commit changes.
**Reference commit:** `39064d24b4df09055cfd4f109cd4da647a290fd1` (`main`, 2026-09-16, tag `v1.16.0-beta.1`)
**Audited by:** AutoAPPZ architecture team (clean-room process)
**Product under development:** AutoAPPZ (working codename in the mission brief: "Forge")

---

## 1. Why this document exists

AutoAPPZ is a **competing product** in the same category as the reference project. That single fact determines the entire legal posture of this effort. The reference repository contains **two licensing regions with fundamentally different terms**, and one of them explicitly prohibits use in a competing product. This audit classifies every region, fixes the rules we operate under, and records which (if any) reference components we intentionally reuse.

The default strategy for every area is:

> **understand concept → document observable behavior → design independently → implement independently**

---

## 2. License regions found

| # | Region | Governing file | License | Evidence |
|---|--------|----------------|---------|----------|
| 1 | Everything outside `src/pro/` | `/LICENSE` | **Apache License 2.0** | `/LICENSE` header: "Content outside of the above mentioned directories … is available under the Apache 2 license" |
| 2 | `src/pro/**` (172 files, ~58,750 TS lines) | `/src/pro/LICENSE` | **Functional Source License 1.1, Apache-2.0 Future License (FSL-1.1-ALv2)**, © 2025 Dyad Tech, Inc. | `/LICENSE` header + `/src/pro/LICENSE` |
| 3 | `packages/@dyad-sh/react-vite-component-tagger`, `packages/@dyad-sh/nextjs-webpack-component-tagger` | own `LICENSE` + `package.json` | Apache-2.0 (declared) | `package.json` `"license": "Apache-2.0"`, `LICENSE` file present in each |
| 4 | `packages/pg-schema-classifier`, `packages/ts-pg-schema-diff` | `package.json` | Declared **MIT** in `package.json`; **no standalone LICENSE file** in either package. Root `/LICENSE` says everything outside `src/pro` is Apache-2.0. | Conflict noted in §6 |
| 5 | `testing/fake-llm-server` | `package.json` | Declared ISC; no LICENSE file; root Apache-2.0 governs | — |
| 6 | Bundled third-party attribution | `/NOTICE` | Lists `mustardscript` (Apache-2.0) and `Playwright` (Apache-2.0) as bundled deps with attribution requirements | `/NOTICE` |
| 7 | Root `package.json` metadata | `package.json` | Declares `"license": "MIT"` — **contradicts** `/LICENSE` (Apache-2.0 + FSL). The `LICENSE` file is authoritative. | Conflict noted in §6 |

### 2.1 What the FSL region actually prohibits

FSL-1.1 grants rights only for a "Permitted Purpose", defined as *any purpose other than a Competing Use*. A Competing Use is making the software available in a commercial product or service that (1) substitutes for the software, (2) substitutes for any product the licensor offers using it, or (3) offers the same or substantially similar functionality.

AutoAPPZ satisfies (1) and (3) by design. Therefore, **for AutoAPPZ, `src/pro/` carries no usable license at all** until its Apache-2.0 future-license date (second anniversary of each version's release — per-version, not a single date). We treat it as fully proprietary.

### 2.2 What lives inside the FSL region (names only)

This matters architecturally: the restricted region is not a fringe "pro features" folder — it contains the **core agentic runtime** of the reference product:

- `src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts` — the agent loop (per `docs/agent_architecture.md`, "the heart of the local agent")
- `src/pro/main/ipc/handlers/local_agent/tool_definitions.ts` — the tool registry
- `src/pro/main/ipc/handlers/local_agent/tools/*` — ~60 tools (read/write/search-replace/grep/list files, run build/tests/type checks, git, execute SQL, sandbox script execution, web fetch/search/crawl, MCP tool discovery, blueprint/plan/todo writing, subagents, image generation, etc.)
- `src/pro/main/ipc/handlers/local_agent/subagents/*` — subagent controller, state, transitions, failure reporting, recovery
- `src/pro/main/ipc/handlers/local_agent/processors/file_operations.ts`
- `src/pro/main/ipc/processors/search_replace_processor.ts` + `src/pro/shared/search_replace_{parser,markers}.ts` — search/replace edit DSL
- `src/pro/main/prompts/turbo_edits_v2_prompt.ts`
- `src/pro/main/ipc/handlers/{themes,visual_editing}_handlers.ts`, `src/pro/main/utils/visual_editing_utils.ts`
- `src/pro/ui/components/Annotator/*` — screenshot annotation canvas
- `src/pro/main/ipc/handlers/local_agent/{chat_search_indexer, mcp_auto_consent, mcp_consent_context, retry_replay_utils, prepare_step_utils, todo_persistence, ai_messages_cleanup}.ts`

### 2.3 Boundary leakage in the reference (informational)

53 Apache-licensed files import from `src/pro/` (e.g. `src/main.ts`, `src/ipc/ipc_host.ts`, `src/ipc/handlers/chat_stream_handlers.ts`, `src/ipc/processors/response_processor.ts`, `src/lib/schemas.ts`, `src/ipc/types/index.ts`). Consequences for us:

1. Apache-side files that *call into* the FSL region are themselves Apache-licensed, but they reveal the FSL region's **interfaces**, not its implementation. We may read them.
2. Type definitions re-exported through `src/ipc/types/index.ts` or `src/lib/schemas.ts` that *originate* in `src/pro` are FSL. When an Apache file re-exports an FSL symbol we treat the symbol as FSL.

---

## 3. Operating rules (binding for every phase)

| Rule | Applies to | Enforcement |
|------|-----------|-------------|
| R1. Never open, read, quote, summarize line-by-line, or paraphrase implementation source under `src/pro/`. Filenames may be inventoried for boundary classification only. | All contributors and agents | Any doc referencing `src/pro` internals is rejected in review. `docs/reference/*` may describe FSL-region *behavior* only as observed from Apache call sites, contracts, prompts, tests, and the reference project's own public docs. |
| R2. Never copy code, comments, docstrings, prompts, or test fixtures from **any** region, Apache included. Independent implementation is the default. | All code in this repo | Reviewers compare suspicious similarities; any reuse must be registered in §5. |
| R3. Never copy branding: the name, logo, icons (`assets/icon/*`), the `dyad://` protocol scheme, `<dyad-*>` tag vocabulary, `@dyad-sh/*` package names, DB table names taken verbatim, or product screenshots. | Everything | Repo-wide grep for the reference product name is a CI check (see M0 in `IMPLEMENTATION-PLAN.md`). |
| R4. Do not mirror the reference file/module/class naming. Names in AutoAPPZ derive from *our* architecture docs, not from the reference tree. | All code | Reviewed against `docs/design/SYSTEM-ARCHITECTURE.md`. |
| R5. Do not mechanically translate reference code into another framework or language; that is a derivative work. | All code | — |
| R6. Design and behavior *concepts* (e.g. "an app has versions backed by git commits", "a preview proxy injects a shim") are not protected expression and may be studied and independently re-implemented. | Design docs | Concepts are recorded in `docs/reference/*` with the rationale for keeping/rejecting them. |
| R7. Third-party OSS dependencies used by the reference (Electron, Vite, Drizzle, AI SDK, etc.) are independently licensed; choosing the same dependency is not reuse of the reference. | Dependency choices | Recorded in ADRs on their own merits. |
| R8. The reference clone lives only in `_reference/` which is git-ignored and never packaged, built, or imported. | Repo layout | `.gitignore`, CI check that `_reference/` is absent from the tree. |

---

## 4. Classification table

Legend — **Inspected?**: whether we read implementation source. **Reused?**: whether any code/asset is carried into AutoAPPZ.

| Area | Reference License | Inspected? | Reused? | Implementation Strategy | Attribution Required |
|------|-------------------|-----------:|--------:|--------------------------|----------------------|
| Electron main bootstrap (`src/main_bootstrap.ts`, `src/main.ts`) | Apache-2.0 | Yes | No | Independent: our own shell with a smaller, module-per-concern bootstrap | No |
| Preload / IPC channel allowlist (`src/preload.ts`, `src/ipc/preload/*`, `src/ipc/contracts/*`) | Apache-2.0 | Yes | No | Independent: typed command bus with schema-validated contracts (ADR-002) | No |
| IPC handlers (`src/ipc/handlers/*`, ~180 files) | Apache-2.0 | Yes (behavior tracing) | No | Independent: domain services behind command bus | No |
| IPC services (`src/ipc/services/*`) | Apache-2.0 | Yes | No | Independent | No |
| IPC utils (`src/ipc/utils/*`, 226 files) | Apache-2.0 | Yes (selective) | No | Independent | No |
| Response processor / XML tag protocol (`src/ipc/processors/response_processor.ts`, `dyad_tag_parser.ts`) | Apache-2.0 | Yes | No | Not carried forward as a concept — we use native tool calling (ADR-004) | No |
| **Local agent runtime** (`src/pro/main/ipc/handlers/local_agent/**`) | **FSL-1.1-ALv2 (restricted)** | **No — filenames only** | **No** | Independent design from first principles (`docs/design/AGENT-ARCHITECTURE.md`); behavior inferred only from Apache call sites, `docs/agent_architecture.md`, e2e specs, and fake-LLM fixtures | No (nothing reused) |
| **Search/replace edit DSL** (`src/pro/main/ipc/processors/search_replace_*`, `src/pro/shared/*`) | **FSL (restricted)** | **No** | **No** | Independent patch engine (File Editing Engine design) | No |
| **Visual editing / themes / annotator** (`src/pro/**`) | **FSL (restricted)** | **No** | **No** | Deferred; if built, designed independently | No |
| **Turbo edits prompt** (`src/pro/main/prompts/*`) | **FSL (restricted)** | **No** | **No** | Own prompts | No |
| System prompts & guides (`src/prompts/*`) | Apache-2.0 | Yes (behavior) | No | Own prompts written from our blueprint model; no text copied | No |
| Chat streaming state machines (`src/chat_stream/*`, `src/state_machines/*`) | Apache-2.0 | Yes | No | Independent state-machine design (concept of explicit main-owned machines retained) | No |
| DB schema & migrations (`src/db/schema.ts`, `drizzle/*`) | Apache-2.0 | Yes | No | Independent schema; different table/column naming | No |
| App runtime / process manager (`src/app_run/*`, `src/ipc/utils/process_manager.ts`) | Apache-2.0 | Yes | No | Independent Runtime Supervisor (ADR-007) | No |
| Preview proxy & injected scripts (`worker/*.js`) | Apache-2.0 | Yes | No | Independent; portability principle forbids a required injected runtime | No |
| Code explorer worker (`workers/code_explorer/*`, `shared/code_explorer_types.ts`) | Apache-2.0 | Yes | No | Independent Context Engine (ADR-009) | No |
| Supabase dependency analysis worker (`workers/supabase_dependency_analysis/*`) | Apache-2.0 | Yes | No | Independent | No |
| Sandbox (`src/ipc/utils/sandbox/*`) + `mustardscript` dependency | Apache-2.0 (mustardscript is a separate Apache-2.0 project) | Yes | No | We do not adopt mustardscript; sandboxing designed in THREAT-MODEL | No |
| Git integration (`src/ipc/utils/git_utils.ts`, `dugite`) | Apache-2.0 (dugite is MIT, separate) | Yes | No | Independent Git service; dependency choice recorded in ADR | No |
| GitHub / Vercel / Neon / Supabase / Coolify integrations | Apache-2.0 | Yes (behavior) | No | Independent adapters behind Integration Hub | No |
| Distributed machines / SSH (`src/distributed_machines/*`, `ssh2`) | Apache-2.0 | Yes (behavior) | No | Out of scope for first slices | No |
| MCP integration (`src/ipc/utils/mcp_*`, `src/mcp_oauth/*`) | Apache-2.0 | Yes | No | Independent | No |
| Renderer UI (`src/components/**`, `src/pages/**`, `src/routes/**`, `src/atoms/**`, `src/hooks/**`) | Apache-2.0 | Yes (UX analysis only) | No | Own design system and layout (Phase 42/43) | No |
| Template scaffold (`scaffold/*`) | Apache-2.0 | Yes | No | Own templates in `templates/` | No |
| Component taggers (`packages/@dyad-sh/*`) | Apache-2.0 | Yes (concept) | No | If we build source-location tagging, we do it independently under our own package name | No |
| `pg-schema-classifier`, `ts-pg-schema-diff` | MIT (pkg) / Apache-2.0 (root) — ambiguous | Yes (concept) | No | Independent schema diff design; or adopt a third-party diff tool | No |
| Fake LLM server & e2e harness (`testing/*`, `e2e-tests/*`) | Apache-2.0 (fake-llm-server pkg says ISC) | Yes (concept) | No | Own deterministic fake-provider harness | No |
| Rules / plans / docs (`rules/*`, `plans/*`, `docs/*`, `AGENTS.md`) | Apache-2.0 | Yes | No (no text copied) | Cited as evidence in reference docs only | No |
| Branding & assets (`assets/*`, product name, `dyad://` scheme) | Trademark / not licensed | No | **No — prohibited** | — | — |
| Bundled third-party NOTICE items (`mustardscript`, `Playwright`) | Apache-2.0 each | n/a | Playwright: **possibly, as an ordinary dependency** for our own e2e tests | Ordinary dependency, not reference reuse | If we bundle Playwright at runtime we carry its NOTICE ourselves |

**Summary: zero reference source files or assets are reused.** The `Reused?` column is expected to remain "No" for the life of the project. If that ever changes, the reuse must be Apache-2.0-licensed, registered here, and the required copyright/NOTICE text added to `/NOTICE`.

---

## 5. Register of intentional reuse

| Item | Source path | License | Where used in AutoAPPZ | Attribution added? |
|------|-------------|---------|------------------------|--------------------|
| *(none)* | — | — | — | — |

---

## 6. Discrepancies and risks noted in the reference

1. **`package.json` says MIT; `LICENSE` says Apache-2.0 + FSL.** The `LICENSE` file governs. We do not rely on the MIT declaration.
2. **`packages/pg-schema-classifier` and `packages/ts-pg-schema-diff` declare MIT but ship no LICENSE file**, while the root LICENSE says everything outside `src/pro` is Apache-2.0. Ambiguous; irrelevant to us because we reuse nothing from them.
3. **FSL "future license" is per-version.** Only versions ≥2 years old become Apache-2.0; newer versions of the same files stay restricted. There is no scenario in which we adopt FSL code.
4. **The reference contributor note** (`CONTRIBUTING.md`) says contributions to `src/pro` are licensed under FSL — confirming the region is intended to be proprietary-in-practice for competitors.
5. **The reference CI/AI workflows** run under `anthropics/claude-code-action` and `codex`; these workflow files are Apache-2.0 but contain org-specific secrets wiring; not reused.

---

## 7. Our obligations for third-party dependencies

AutoAPPZ will ship its own `LICENSE` (Apache-2.0, decided in ADR-000) and a `NOTICE` file listing every bundled dependency that requires attribution (generated from the lockfile at release time, see `docs/development/RELEASE.md`). None of those obligations originate from the reference project.

---

## 8. Verification checklist (run at every release)

- [ ] `_reference/` is absent from the packaged app and from `git ls-files`.
- [ ] Repo-wide search for the reference product name, `dyad://`, `<dyad-`, `@dyad-sh` returns zero hits outside `docs/reference/` and `docs/legal/`.
- [ ] No file in `packages/**` or `apps/**` has a header or comment attributable to the reference.
- [ ] §5 register matches `/NOTICE`.
