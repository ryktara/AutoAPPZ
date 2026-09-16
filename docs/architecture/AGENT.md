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
