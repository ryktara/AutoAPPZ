# Agent (`packages/core`, `packages/agent`, `packages/tools`, `packages/validation`)

Canonical design: `docs/design/AGENT-ARCHITECTURE.md`. This page fixes the engineering contracts.

## Core types
```ts
type TaskState = "IDLE"|"UNDERSTAND"|"EXPLORE"|"PLAN"|"AWAIT_APPROVAL"|"EXECUTE"|"VALIDATE"|"DIAGNOSE"|"REPAIR"|"REVIEW"|"CHECKPOINT"|"COMPLETE"|"CANCELLED"|"NEEDS_USER"|"INTERRUPTED";
interface Task { id; projectId; sessionId; request; complexity: "trivial"|"standard"|"complex"; state; plan?; criteria: AcceptanceCriterion[]; changeSet; validation: ValidationReport[]; repairs: number; checkpointId?; cost: UsageSummary; createdAt; updatedAt }
type TaskEvent = { type: "submit"|"context_sufficient"|"needs_context"|"explored"|"plan_ready"|"plan_skipped"|"approved"|"revise"|"rejected"|"edits_applied"|"checks_passed"|"checks_failed"|"diagnosis_ready"|"attempts_exhausted"|"fix_applied"|"review_passed"|"review_requests_changes"|"checkpoint_created"|"answered"|"failed"|"cancel"|"user_input"|"process_exit"|"resume"|"resume_unsafe"; payload? }
function transition(state: TaskState, event: TaskEvent, ctx: TaskContext): { state: TaskState; effects: Effect[] }
```
Effects (`runModel`, `runTool`, `runValidators`, `createCheckpoint`, `askUser`, `emit`) are executed by the core runner; each effect result re-enters as an event; every transition is journaled.

Implemented in `packages/agent/src/state-machine.ts` (pure, fully tested) and driven by `packages/core` `TaskService`. `ask` tasks take the short path UNDERSTAND → EXECUTE → COMPLETE with the `answered` event; `failed` from any live state lands in NEEDS_USER.

Build tasks (M6): `runBuild` in `packages/core` drives PLAN (planner prompt → JSON plan, `plan_skipped` for trivial, `plan_auto_approved` per policy), AWAIT_APPROVAL (`task.approve|revise|reject`), EXECUTE (builder tool loop: `streamText` with the tool runtime's JSON-Schema specs, tool calls executed through `ToolRuntime` so permissions/audit/read-ledger apply), VALIDATE (explicit pass until M10), REVIEW (reviewer prompt for complex tasks, one bounded round), CHECKPOINT (recorded; git lands in M9) → COMPLETE. Budgets: `profileFor(complexity)` sets `maxToolSteps`/`maxModelCalls`; exceeding either ends in NEEDS_USER with a resumable error.

## Role runs
`runRole(role, task, ctx) → RoleResult` with its own `agentRunId`, model selection (router), context pack (Context Engine) and tool subset (permission-filtered). Prompts are versioned templates in `packages/agent/prompts` with snapshot tests.

## Tool loop
AI SDK `streamText` with tools; loop guard: `maxSteps` per run, token/cost budget per task; parallel read-only calls; serialized writes; structured tool results (`summaryForModel` ≤ 2k tokens + artifacts). Read-before-write and `expectedHash` enforced in `packages/tools`.

## Validation & repair
`packages/validation` exposes `Validator { id; applicableTo(changeSet); run(ctx) → Diagnostic[] }` ordered by cost tier; the repair driver selects diagnostics (dedupe by file+code, top-N), builds a REPAIR context and enforces attempt limits (default 3) and scope guards.

## Budgets and cost
`UsageRecord { taskId, agentRunId, provider, model, inputTokens, outputTokens, cachedTokens?, estimatedCost, at }`; budgets per task/project/month with warning thresholds; exceeding → `NEEDS_USER`.

## Memory
`ProjectMemoryFact { id, category, statement, provenance: {taskId}, confidence, createdAt, supersededBy? }` written by Reviewer/Architect; retrieval by category + lexical match; editable in UI.

## Implementation notes — validation & repair (M10)
- `packages/validation`: validators behind `Validator { id, tier, applies(ctx), run(ctx) }` — `syntax` (tier 0: project-local `typescript` transpile diagnostics or a bracket heuristic, JSON parse), `typecheck` (tier 1: `tsc -p tsconfig.json --noEmit --pretty false`), `lint` (tier 1: `eslint --format json` over changed files), `tests` (tier 2: `vitest related --run` over changed files, whole suite when nothing changed), `build` (tier 3: the package manager's `build` script). CLIs resolve from `node_modules/.bin` walking up from the project (Windows shims → `node <entry>`), spawn as argument arrays with the runtime env allowlist, bounded output, per-tier timeouts and process-tree kill on cancel.
- `runValidation` runs validators in cost order and stops after the first failing tier; inapplicable validators are reported `skipped` with the reason. A tool that cannot run (`error`, e.g. timeout) is surfaced but does not count as failing, so the repair loop is never driven by tooling problems.
- Repair selection: diagnostics deduplicated by file/line/code/message, errors first, changed files first, capped at 12; rendered as lines for the builder together with "N more not shown".
- `TaskService.validateLoop`: VALIDATE → `checks_failed` → DIAGNOSE → `diagnosis_ready` → REPAIR (builder loop with the repair notes, retrieval phase `repair`) → `fix_applied` → VALIDATE, at most `MAX_REPAIR_ATTEMPTS = 3` rounds, then NEEDS_USER with a retryable error naming the summary. Every attempt is persisted (`task_validations`) and streamed as a `validation` chunk. Tier by complexity: trivial → 1, standard → 2, complex → 3.
- **Diagnose & fix**: `task.submit` with `intent: "fix"` takes the checkpoint, skips planning and editing, validates the uncommitted tree (dirty files from git status) and repairs from there; the summary reports "No problems found" or "Fixed the failing checks".
- Validation diagnostics are also written to the context index (`diagnostics` table), which the repair phase weights highest.
- Deferred: runtime smoke and browser checks as validators (the preview proxy already reports runtime errors to the Problems dock), per-project validator configuration, parallel validators within a tier.
