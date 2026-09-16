import type { providers } from "@autoappz/contracts";

/**
 * Cheap, deterministic first-pass complexity estimate from the request text alone.
 * The planner refines it later; here it only steers routing and the approval policy.
 */
export function classifyComplexity(request: string): providers.Complexity {
  const text = request.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const heavy =
    /\b(architect|migrat|refactor|entire|whole app|full app|end[- ]to[- ]end|authentication|database|deploy|multi[- ]tenant|integrat)/i.test(
      text,
    );
  const bullets = (text.match(/^\s*(?:[-*]|\d+\.)\s+/gm) ?? []).length;
  if (heavy || words > 250 || bullets >= 5) return "complex";
  if (words < 15 && bullets === 0) return "trivial";
  return "standard";
}
