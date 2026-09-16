import type { ModelPricing, TokenUsage } from "./types.ts";

/** USD cost estimate; undefined pricing (local / unknown models) yields 0 and the UI says "n/a". */
export function estimateCostUsd(usage: TokenUsage, pricing: ModelPricing | undefined): number {
  if (!pricing) return 0;
  const cached = usage.cachedInputTokens ?? 0;
  const uncached = Math.max(0, usage.inputTokens - cached);
  const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion;
  const cost =
    (uncached * pricing.inputPerMillion +
      cached * cachedRate +
      usage.outputTokens * pricing.outputPerMillion) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * Rough token estimate used for budgeting before a call (real usage comes from the provider).
 * ~4 chars per token for English/code; whitespace-heavy code is slightly cheaper.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `<$0.01`;
  return `$${value.toFixed(2)}`;
}
