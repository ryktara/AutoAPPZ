# User Flows

Each flow: trigger → surfaces → states → commands → persisted → failures → recovery.

## F1 First launch and provider setup
Home (Request pane) with prompt box and "Providers" card row (OpenAI, Anthropic, Google, xAI, OpenAI-compatible, Ollama) — all equal. Submitting without a provider parks the request and opens provider setup inline; on save, the parked request resumes. Commands: `settings.get`, `secrets.set`, `providers.validate`. Failures: invalid key → inline error with provider docs link; offline → retry with cached catalog.

## F2 Create project from request (vertical slice)
1. Prompt → `project.create` (template react-vite) → `task.submit`.
2. UNDERSTAND/EXPLORE (fast) → PLAN: Blueprint questionnaire (≤5 questions) → Blueprint card (pages, entities, roles, auth, integrations, design system, AC) → **Approve** (editable).
3. EXECUTE: Execution pane streams tool activity; Changes pane fills; runtime `install` starts in parallel.
4. VALIDATE: syntax → typecheck → lint → tests → build → runtime smoke; Validation pane shows results.
5. Preview appears; Runtime Observer watches; errors show a banner with "Diagnose & fix" (creates a REPAIR round bound to the task).
6. REVIEW → criteria matrix → CHECKPOINT (commit with trailer) → COMPLETE with summary and cost.
Failures at any step end in NEEDS_USER with options (retry, stronger model, rollback, manual). Reopen later restores the workspace from the catalog and last session.

## F3 Modify an existing project
Request → plan (auto-approved below complexity threshold if project policy allows) → execute with retrieval explanations → validate/repair → checkpoint. Undo from the Changes pane restores user edits captured in the checkpoint.

## F4 Import an existing repository
Choose folder → import in place (default) or copy → index in background → runtime profile prompt for untrusted dependencies (host vs container) → nothing executes until the user starts the runtime.

## F5 Runtime and preview
Start/Stop/Restart/Rebuild per phase; port lease shown; health status; logs dock with filters; terminal.

## F6 Git
Checkpoints list (per task), compare, restore file, branch-from-checkpoint, commit dialog with hooks, uncommitted changes surface, GitHub connect/push (M12).

## F7 Integrations hub
Single project surface: Database (Postgres/Supabase/Neon), Deployment (Vercel/Netlify/Cloudflare/Docker), VCS (GitHub), MCP servers — each with readiness status and setup flows (OAuth via loopback PKCE, keys via secrets service).

## F8 Permissions and consent
Consent sheet shows capability, scope, risk, what will happen; choices once/session/project/deny; audit visible in task record.

## F9 Errors and recovery
Every failure card: what failed, likely cause, what the system will try, what you can do — with actions.

## Usability protocol
Five participants per persona group perform F2 and F3 on fixed prompts; measure time, actions, errors, satisfaction (SUS). Baseline against the reference product for the same script.
