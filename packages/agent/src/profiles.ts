import type { providers } from "@autoappz/contracts";

/**
 * Complexity profiles decide which roles run (docs/design/AGENT-ARCHITECTURE.md §1).
 * Roles are strategies: a trivial task is a single builder sequence; a complex one plans, builds and reviews.
 */
export interface ComplexityProfile {
  /** Skip the planner and go straight to the builder (single model sequence). */
  readonly skipPlan: boolean;
  /** none: no reviewer call; full: reviewer model call with a bounded re-execute round. */
  readonly review: "none" | "full";
  readonly maxToolSteps: number;
  readonly maxModelCalls: number;
}

export function profileFor(complexity: providers.Complexity): ComplexityProfile {
  switch (complexity) {
    case "trivial":
      return { skipPlan: true, review: "none", maxToolSteps: 12, maxModelCalls: 6 };
    case "standard":
      return { skipPlan: false, review: "none", maxToolSteps: 30, maxModelCalls: 20 };
    case "complex":
      return { skipPlan: false, review: "full", maxToolSteps: 60, maxModelCalls: 40 };
  }
}

export type ApprovalThreshold = "none" | "trivial" | "standard";

/** Whether a plan of the given complexity may run without the approval gate. */
export function autoApproves(threshold: ApprovalThreshold, complexity: providers.Complexity): boolean {
  if (threshold === "none") return false;
  if (threshold === "trivial") return complexity === "trivial";
  return complexity !== "complex";
}
