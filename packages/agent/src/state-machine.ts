import { tasks } from "@autoappz/contracts";

type TaskState = tasks.TaskState;

export type TaskEventType =
  | "submit"
  | "context_sufficient"
  | "needs_context"
  | "explored"
  | "plan_ready"
  | "plan_skipped"
  | "approved"
  | "revise"
  | "rejected"
  | "edits_applied"
  | "checks_passed"
  | "checks_failed"
  | "diagnosis_ready"
  | "attempts_exhausted"
  | "fix_applied"
  | "review_passed"
  | "review_requests_changes"
  | "checkpoint_created"
  | "answered"
  | "failed"
  | "cancel"
  | "user_input"
  | "process_exit"
  | "resume"
  | "resume_unsafe";

export interface TaskEvent {
  readonly type: TaskEventType;
  readonly payload?: Record<string, unknown> | undefined;
}

/** Side effects the runner executes after a transition; each result re-enters as an event. */
export type Effect =
  | { readonly type: "runModel"; readonly role: "answer" | "planner" | "builder" | "reviewer" }
  | { readonly type: "runValidators" }
  | { readonly type: "createCheckpoint" }
  | { readonly type: "askUser"; readonly reason: string }
  | { readonly type: "finish"; readonly outcome: "complete" | "cancelled" | "needs_user" | "interrupted" };

export interface TransitionResult {
  readonly state: TaskState;
  readonly effects: readonly Effect[];
}

export const INITIAL_TASK_STATE: TaskState = "UNDERSTAND";

interface TransitionContext {
  readonly mode: tasks.TaskMode;
  readonly repairAttempts: number;
  readonly maxRepairAttempts: number;
}

/**
 * Pure task state machine (docs/design/AGENT-ARCHITECTURE.md §2). Unknown (state, event) pairs return
 * the same state with no effects so a stray event can never corrupt a task. Journaling is the caller's job.
 */
export function transition(state: TaskState, event: TaskEvent, ctx: TransitionContext): TransitionResult {
  // Universal events
  if (event.type === "cancel" && !tasks.isTerminalTaskState(state) && state !== "INTERRUPTED") {
    return { state: "CANCELLED", effects: [{ type: "finish", outcome: "cancelled" }] };
  }
  if (event.type === "failed" && !tasks.isTerminalTaskState(state)) {
    return { state: "NEEDS_USER", effects: [{ type: "finish", outcome: "needs_user" }] };
  }
  if (event.type === "process_exit" && !tasks.isTerminalTaskState(state) && state !== "NEEDS_USER") {
    return { state: "INTERRUPTED", effects: [{ type: "finish", outcome: "interrupted" }] };
  }

  switch (state) {
    case "UNDERSTAND":
      if (event.type === "context_sufficient") {
        return ctx.mode === "ask"
          ? { state: "EXECUTE", effects: [{ type: "runModel", role: "answer" }] }
          : { state: "PLAN", effects: [{ type: "runModel", role: "planner" }] };
      }
      if (event.type === "needs_context") return { state: "EXPLORE", effects: [] };
      return stay(state);
    case "EXPLORE":
      if (event.type === "explored") {
        return ctx.mode === "ask"
          ? { state: "EXECUTE", effects: [{ type: "runModel", role: "answer" }] }
          : { state: "PLAN", effects: [{ type: "runModel", role: "planner" }] };
      }
      return stay(state);
    case "PLAN":
      if (event.type === "plan_ready")
        return { state: "AWAIT_APPROVAL", effects: [{ type: "askUser", reason: "approve_plan" }] };
      if (event.type === "plan_skipped")
        return { state: "EXECUTE", effects: [{ type: "runModel", role: "builder" }] };
      return stay(state);
    case "AWAIT_APPROVAL":
      if (event.type === "approved")
        return { state: "EXECUTE", effects: [{ type: "runModel", role: "builder" }] };
      if (event.type === "revise") return { state: "PLAN", effects: [{ type: "runModel", role: "planner" }] };
      if (event.type === "rejected")
        return { state: "CANCELLED", effects: [{ type: "finish", outcome: "cancelled" }] };
      return stay(state);
    case "EXECUTE":
      if (event.type === "answered")
        return { state: "COMPLETE", effects: [{ type: "finish", outcome: "complete" }] };
      if (event.type === "edits_applied") return { state: "VALIDATE", effects: [{ type: "runValidators" }] };
      return stay(state);
    case "VALIDATE":
      if (event.type === "checks_passed")
        return { state: "REVIEW", effects: [{ type: "runModel", role: "reviewer" }] };
      if (event.type === "checks_failed") return { state: "DIAGNOSE", effects: [] };
      return stay(state);
    case "DIAGNOSE":
      if (event.type === "diagnosis_ready") {
        if (ctx.repairAttempts >= ctx.maxRepairAttempts) {
          return { state: "NEEDS_USER", effects: [{ type: "askUser", reason: "repair_attempts_exhausted" }] };
        }
        return { state: "REPAIR", effects: [{ type: "runModel", role: "builder" }] };
      }
      if (event.type === "attempts_exhausted")
        return { state: "NEEDS_USER", effects: [{ type: "askUser", reason: "repair_attempts_exhausted" }] };
      return stay(state);
    case "REPAIR":
      if (event.type === "fix_applied") return { state: "VALIDATE", effects: [{ type: "runValidators" }] };
      return stay(state);
    case "REVIEW":
      if (event.type === "review_passed")
        return { state: "CHECKPOINT", effects: [{ type: "createCheckpoint" }] };
      if (event.type === "review_requests_changes")
        return { state: "EXECUTE", effects: [{ type: "runModel", role: "builder" }] };
      return stay(state);
    case "CHECKPOINT":
      if (event.type === "checkpoint_created")
        return { state: "COMPLETE", effects: [{ type: "finish", outcome: "complete" }] };
      return stay(state);
    case "NEEDS_USER":
      if (event.type === "user_input") return { state: "UNDERSTAND", effects: [] };
      return stay(state);
    case "INTERRUPTED":
      if (event.type === "resume") return { state: "VALIDATE", effects: [{ type: "runValidators" }] };
      if (event.type === "resume_unsafe")
        return { state: "NEEDS_USER", effects: [{ type: "askUser", reason: "resume_unsafe" }] };
      return stay(state);
    case "COMPLETE":
    case "CANCELLED":
      return stay(state);
  }
}

function stay(state: TaskState): TransitionResult {
  return { state, effects: [] };
}
