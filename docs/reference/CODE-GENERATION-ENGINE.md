# Code Generation Engine — `dyad-sh/dyad` @ `39064d24`

How applications are scaffolded, which stacks are supported, what rules steer the model, how generated files are validated, and why generations succeed or fail.

---

## 1. Scaffolding

| Template | Source | Stack | Notes |
|---|---|---|---|
| `react` (default) | bundled `scaffold/` copied recursively | Vite 8 + React 19 + TS + Tailwind **3** + shadcn/Radix + React Router 6 + TanStack Query + react-hook-form/zod + recharts + sonner; `vercel.json`; ESLint 9 | devDependency on the vendor's component tagger (`@dyad-sh/react-vite-component-tagger`) for source-location tagging → **not fully portable** |
| `next` | `git clone --depth 1` of `dyad-sh/nextjs-template` into `userData/templates` (refreshed by comparing GitHub HEAD SHA) | Next.js + shadcn + Tailwind | webpack component tagger |
| `react-vite-nitro` (experimental) | GitHub clone | Vite + Nitro server layer | for API routes/DB from Vite apps |
| `portal-mini-store` (experimental, requires Neon) | GitHub clone | Next.js + Payload CMS + Neon | |
| Community templates | remote API (`ApiTemplate`) | arbitrary GitHub repos | `acceptedCommunityCode` consent |

Copy excludes `node_modules` and `.git`; the app then gets its own `git init` + "Init Dyad app" commit. `AI_RULES.md` from the template becomes the model's project instructions.

## 2. Prompt rules that shape generated code (Apache prompts)

- Stack rules from `AI_RULES.md` (default: React Router in `src/App.tsx`, pages in `src/pages`, components in `src/components`, `src/pages/Index.tsx` is the main page and must be updated so components are visible, always shadcn/Tailwind, lucide icons).
- Quality rules: complete files, no placeholders/TODOs, responsive designs, toasts for important events, ≤100-line components, refactor prompts when files grow, "do not over-engineer", only requested changes, don't add error handling for impossible cases, security (OWASP) awareness.
- Workflow rules: Understand (grep/list/read or Explorer) → Clarify (questionnaire ≤5 questions) → Plan (`update_todos`) → Implement → Verify (`run_type_checks`, tests, pre-commit, expensive `run_build` only when warranted) → Finalize (summary).
- Framework nudges: Vite apps → `enable_nitro` before server code; choose DB provider first via `add_integration`; Next.js uses built-in routes.
- Database rules: Supabase RLS/grants/JWT/service-role; Neon no browser DB URL, no custom auth, `read_guide` before auth code.
- Testing rules: Playwright specs under `e2e-tests/`, role-based locators, isolated data, fixture conventions, bounded fix attempts.

## 3. Framework and package detection

- `detectFrameworkType(appPath)`: Next.js config files or `next` dep → `nextjs`; Vite config or `vite` dep → `vite` / `vite-nitro` (nitro config or dep); else `other`; `detectNextJsMajorVersion`; `declaresStart` (start script/main/index).
- Package manager: `getPackageManagerSignal` (lockfiles/`packageManager` field) → pnpm preferred when available and ≥ minimum-release-age version (10.16), else npm; Corepack project pins ignored via env; managed pnpm can be installed by the app.
- Dependency install for the agent: `add_dependency` → strict spec grammar (name + exact/partial/range/dist-tag; scoped ok; tarballs rejected) → `pnpm add --ignore-workspace-root-check …` / `npm install` through a PTY runner with timeout; optional Socket firewall (`npx sfw`) when `blockUnsafeNpmPackages`; pnpm `minimumReleaseAge` policy (1 day) and allow-builds list (`pnpm-workspace.yaml`, remote default list cached 1 h) to avoid running untrusted install scripts; denied builds recorded and reported.

## 4. Source parsing, indexing, AST usage

- Regex-based tag parsing for gen-1 XML (`dyad_tag_parser.ts`): `<dyad-write path description>`, rename/delete/copy/add-dependency/execute-sql/search-replace/command/chat-summary; strips markdown fences inside writes; XML attribute unescaping.
- `recast`/`@babel/parser` are dependencies (used by `ai_rules_patcher.ts`/`vite_config_patcher.ts` to patch config files, `UNVERIFIED` full usage).
- TypeScript compiler API used only in the code-explorer worker (Phase 6) — no AST-aware editing of generated code.
- `search_replace` is text/line-based, not AST-aware.

## 5. Context selection for generation

See `AGENT-RUNTIME.md §4`. Gen 2 relies on the model's own reads; the prompt biases toward Explorer sub-agent (Pro) or grep/list/read. Selected components (from the preview's component selector → `data-dyad-*` attributes injected by the component tagger) are added to the prompt as file+line snippets with an `// <-- EDIT HERE` marker.

## 6. Validation of generated files

| Check | When | Mechanism |
|---|---|---|
| Path safety | every write/delete/rename | `safeJoin`, realpath containment, root refusal, symlink rules |
| Search/replace applicability | gen 1: dry run before apply, 2 repair rounds; gen 2: tool fails loudly | `applySearchReplace` (FSL) |
| Unclosed writes | gen 1 | continuation prompt ≤2 |
| Type checking | on demand (Problems panel, `run_type_checks`), not automatic | app-local `tsc --noEmit --incremental --pretty false --project tsconfig.app.json`, diagnostics parsed into `ProblemReport {file,line,column,message,code,snippet}`; precondition guidance if TS missing |
| Lint | **none** (no ESLint run; `@biomejs/biome` dependency present — `UNVERIFIED` usage, likely formatting) | — |
| Tests | on demand (`run_tests`, Tests panel), proactive spec maintenance when `testingEnabled` | Playwright with Dyad-owned config, isolated workspace (`npm ci`/`pnpm install --frozen-lockfile`, 15 min budget), Neon test branch / Supabase test user isolation, screenshots + `error-context.md` fed back |
| Build | on demand (`run_build`) | isolated detached git worktree + overlay, deadline, attempt limits, install failures tracked separately |
| Pre-commit | `run_pre_commit` / commit dialog | repo hooks with timeouts and stable error codes |
| Runtime | preview shim reports window errors, unhandled rejections, Vite overlay build errors, sourcemapped stacks; console/network capture | user-triggered fix |
| Formatting | **none** observed for generated code (`UNVERIFIED` biome) | — |
| Security review | `/security-review` intent produces `<dyad-security-finding>` cards; fix chats tracked in `security_fix_chats` | model-based |

## 7. Runtime error collection and automatic repair

- Collection: dev-server stdout/stderr → console entries; shim → error banner (`PreviewError {message, source: app\|dyad-app\|dyad-sync, stack?}`); Vite overlay text extracted; network failures via service worker (`UNVERIFIED` surfacing).
- Repair: **manual trigger** ("Fix error with AI", "Fix All Errors", Problems "Fix all/selected", "Fix pre-commit with AI", merge-conflict resolution with AI). Within a turn the model may iterate on `run_type_checks`/`run_tests` results (test fix attempts are bounded by the tool). There is no automatic post-turn validate→repair cycle; the deprecated `enableAutoFixProblems` setting confirms auto-fix was removed.

## 8. Database migration generation

- Supabase: SQL executed through the management API; when `enableSupabaseWriteSqlMigration` is on and the statement mutates schema, a timestamped file is written under `supabase/migrations/` (only after successful execution).
- Neon: SQL executed on the active branch; the template stack (Drizzle in Portal template) generates its own migrations (`UNVERIFIED`); DB timestamps captured per version enable restore.
- Schema introspection: `get_database_table_schema` renders replayable DDL from a shared `Schema` model (`ts-pg-schema-diff`), with dependency retention rules.

## 9. Why generations succeed or fail (observed causes)

**Succeed because:** strong stack constraints (one known scaffold), explicit "no partial implementation" rules, tool loop with `read_file` before edits, `search_replace` failing loudly, type-check tool, proactive test guidance, git checkpoint per turn, preview feedback loop, blueprint questionnaire clarifying intent early, explorer sub-agent for existing code.

**Fail because (evidence in code/rules/e2e):**
1. Validation is optional and model-initiated: a turn can end with type errors or a broken build because nothing runs after the turn unless the model chose to.
2. Vite-only scaffold has no server layer; server-side requests require an integration detour (Nitro/Supabase/Neon) that the model must sequence correctly (prompt spends many lines on ordering rules).
3. Search/replace is line-based text matching; models produce mismatches (two repair rounds exist for gen 1, "fallback to write_file" for gen 2) — a root cause of mangled files.
4. Dependency install races: install and chat checkpoints deliberately interleave; lockfiles may land in later commits.
5. Context blindness: without smart context (Pro), a model that does not read enough files edits blindly; stop-words search heuristics are shallow.
6. Free-tier constraints: Basic Agent lacks code search/web tools; Google-only keys are pushed to Build mode due to rate limits.
7. Step limits pause mid-task; recovery requires user action.
8. Blueprint in memory: restart loses it; questionnaire answers must be re-derived from history.
9. Long-tail runtime issues: pnpm build-script denial (self-heal exists), Docker/cloud variance, Windows path/locking issues (many workarounds in `git_utils`, rename, delete).
10. "Done" is not defined by acceptance criteria; the reviewer sub-agent (Pro) reviews the diff against the request, but nothing traces requirements.
