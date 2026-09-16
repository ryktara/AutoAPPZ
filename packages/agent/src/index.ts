/**
 * Task lifecycle (docs/architecture/AGENT.md). The transition function lands in M4;
 * the vocabulary is fixed here so contracts and UI can reference it from M1 on.
 */
export const TASK_STATES = [
  "UNDERSTAND",
  "EXPLORE",
  "PLAN",
  "AWAIT_APPROVAL",
  "EXECUTE",
  "VALIDATE",
  "DIAGNOSE",
  "REPAIR",
  "REVIEW",
  "CHECKPOINT",
  "COMPLETE",
  "CANCELLED",
  "NEEDS_USER",
  "INTERRUPTED",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TERMINAL_TASK_STATES: ReadonlySet<TaskState> = new Set(["COMPLETE", "CANCELLED"]);

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.has(state);
}

export type ComplexityProfile = "trivial" | "standard" | "complex";

/** A role is a strategy the orchestrator activates conditionally; it is never a mandatory pipeline stage. */
export interface RoleStrategy {
  readonly id: string;
  /** Return true when this role should run for the given task/state. */
  activatesFor(input: { state: TaskState; complexity: ComplexityProfile }): boolean;
}
