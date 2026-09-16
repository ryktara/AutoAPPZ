import type { providers as contracts } from "@autoappz/contracts";
import type { ModelCapabilities, ModelDescriptor } from "./types.ts";

type RoutingIntent = contracts.RoutingIntent;
type Complexity = contracts.Complexity;
type RoutingPolicy = contracts.RoutingPolicy;
type ModelRef = contracts.ModelRef;
type RouteDecision = contracts.RouteDecision;

export interface RouteRequest {
  readonly intent: RoutingIntent;
  readonly complexity: Complexity;
  /** Hard requirements on top of what the intent implies. */
  readonly requires?:
    Partial<Pick<ModelCapabilities, "vision" | "toolCalling" | "jsonMode" | "largeContext">> | undefined;
  readonly minContextWindow?: number | undefined;
}

export interface RouterInputs {
  readonly candidates: readonly ModelDescriptor[];
  readonly policy: RoutingPolicy;
  readonly overrides: Partial<Record<RoutingIntent, ModelRef>>;
  readonly globalOverride?: ModelRef | undefined;
}

/** What each intent wants, before complexity adjustments. */
const INTENT_PROFILE: Record<
  RoutingIntent,
  { needsReasoning: boolean; prefersFast: boolean; needsTools: boolean }
> = {
  planning: { needsReasoning: true, prefersFast: false, needsTools: false },
  coding: { needsReasoning: false, prefersFast: false, needsTools: true },
  fastEdit: { needsReasoning: false, prefersFast: true, needsTools: true },
  review: { needsReasoning: true, prefersFast: false, needsTools: false },
  debug: { needsReasoning: true, prefersFast: false, needsTools: true },
  summarize: { needsReasoning: false, prefersFast: true, needsTools: false },
  classify: { needsReasoning: false, prefersFast: true, needsTools: false },
};

/**
 * Deterministic, explainable model selection. Order of authority:
 * global user override → per-intent override → policy hard filters → scored preference.
 */
export function routeModel(request: RouteRequest, inputs: RouterInputs): RouteDecision | null {
  const { candidates, policy } = inputs;
  const find = (ref: ModelRef) =>
    candidates.find((m) => m.providerId === ref.providerId && m.modelId === ref.modelId);

  if (inputs.globalOverride) {
    const m = find(inputs.globalOverride);
    if (m)
      return {
        model: m,
        reason: "User selected this model for everything.",
        candidates: candidates.length,
        overridden: true,
      };
  }
  const intentOverride = inputs.overrides[request.intent];
  if (intentOverride) {
    const m = find(intentOverride);
    if (m)
      return {
        model: m,
        reason: `User selected this model for ${request.intent}.`,
        candidates: candidates.length,
        overridden: true,
      };
  }

  const profile = INTENT_PROFILE[request.intent];
  const wantsReasoning = profile.needsReasoning || request.complexity === "complex";
  const prefersFast = profile.prefersFast || request.complexity === "trivial";

  const eligible = candidates.filter((m) => {
    if (policy.privacy === "local-only" && !m.capabilities.local) return false;
    if (profile.needsTools && !m.capabilities.toolCalling) return false;
    if (request.requires?.vision && !m.capabilities.vision) return false;
    if (request.requires?.toolCalling && !m.capabilities.toolCalling) return false;
    if (request.requires?.jsonMode && !m.capabilities.jsonMode) return false;
    if (request.requires?.largeContext && !m.capabilities.largeContext) return false;
    if (request.minContextWindow !== undefined && m.capabilities.contextWindow < request.minContextWindow)
      return false;
    return true;
  });
  if (eligible.length === 0) return null;

  const scored = eligible.map((m) => {
    let score = 0;
    const why: string[] = [];
    if (wantsReasoning && m.capabilities.reasoning) {
      score += 3;
      why.push("reasoning");
    }
    if (!wantsReasoning && !m.capabilities.reasoning && prefersFast) {
      score += 1;
    }
    if (prefersFast && m.capabilities.fastEdit) {
      score += 2 * (0.5 + policy.latencyWeight);
      why.push("fast");
    }
    if (m.capabilities.inexpensive) {
      score += 2 * policy.costWeight;
      why.push("inexpensive");
    }
    if (!m.capabilities.inexpensive && prefersFast) score -= policy.costWeight;
    if (m.capabilities.local && policy.privacy === "local-only") why.push("local");
    if (m.capabilities.largeContext && request.complexity === "complex") {
      score += 0.5;
    }
    // Catalog models have known pricing and behaviour; prefer them over unknown discoveries on ties.
    if (m.source === "catalog") score += 0.25;
    return { m, score, why };
  });
  scored.sort((a, b) => b.score - a.score || a.m.modelId.localeCompare(b.m.modelId));
  const best = scored[0];
  if (!best) return null;
  const traits = best.why.length > 0 ? best.why.join(", ") : "best available match";
  return {
    model: best.m,
    reason: `Chosen for ${request.intent} (${request.complexity}): ${traits}.`,
    candidates: eligible.length,
    overridden: false,
  };
}
