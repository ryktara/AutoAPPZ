/**
 * Token estimate without a tokenizer dependency: ~4 characters per token for code/prose, corrected for
 * whitespace-heavy content. Deliberately conservative (rounds up) so budgets are never exceeded.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const compact = text.replace(/[ \t]{2,}/g, " ");
  return Math.ceil(compact.length / 3.8);
}

export interface TokenBudget {
  readonly total: number;
  /** Fraction of `total` any single source may occupy (diversification guard). */
  readonly perSourceShare?: number | undefined;
}
