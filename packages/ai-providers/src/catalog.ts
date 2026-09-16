import type { ModelCapabilities, ModelDescriptor, ModelPricing, ProviderId } from "./types.ts";

/**
 * Curated model catalog. Capabilities are what the router reasons about; pricing is an estimate
 * (USD per million tokens) shown as such. Discovery adds models missing here with conservative defaults.
 */
export const CATALOG_VERSION = "2026-09";

const caps = (
  partial: Partial<ModelCapabilities> & Pick<ModelCapabilities, "contextWindow" | "maxOutputTokens">,
): ModelCapabilities => ({
  reasoning: false,
  fastEdit: false,
  vision: false,
  largeContext: partial.contextWindow >= 200_000,
  toolCalling: true,
  local: false,
  inexpensive: false,
  jsonMode: true,
  ...partial,
});

const price = (
  inputPerMillion: number,
  outputPerMillion: number,
  cachedInputPerMillion?: number,
): ModelPricing =>
  cachedInputPerMillion === undefined
    ? { inputPerMillion, outputPerMillion }
    : { inputPerMillion, outputPerMillion, cachedInputPerMillion };

interface CatalogEntry {
  providerId: ProviderId;
  modelId: string;
  displayName: string;
  capabilities: ModelCapabilities;
  pricing?: ModelPricing;
}

const ENTRIES: readonly CatalogEntry[] = [
  // OpenAI
  {
    providerId: "openai",
    modelId: "gpt-5",
    displayName: "GPT-5",
    capabilities: caps({ reasoning: true, vision: true, contextWindow: 400_000, maxOutputTokens: 128_000 }),
    pricing: price(1.25, 10, 0.125),
  },
  {
    providerId: "openai",
    modelId: "gpt-5-mini",
    displayName: "GPT-5 mini",
    capabilities: caps({
      reasoning: true,
      vision: true,
      fastEdit: true,
      inexpensive: true,
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
    }),
    pricing: price(0.25, 2, 0.025),
  },
  {
    providerId: "openai",
    modelId: "gpt-5-nano",
    displayName: "GPT-5 nano",
    capabilities: caps({
      fastEdit: true,
      inexpensive: true,
      vision: true,
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
    }),
    pricing: price(0.05, 0.4, 0.005),
  },
  {
    providerId: "openai",
    modelId: "gpt-4.1",
    displayName: "GPT-4.1",
    capabilities: caps({ vision: true, contextWindow: 1_047_576, maxOutputTokens: 32_768 }),
    pricing: price(2, 8, 0.5),
  },
  {
    providerId: "openai",
    modelId: "gpt-4.1-mini",
    displayName: "GPT-4.1 mini",
    capabilities: caps({
      vision: true,
      fastEdit: true,
      inexpensive: true,
      contextWindow: 1_047_576,
      maxOutputTokens: 32_768,
    }),
    pricing: price(0.4, 1.6, 0.1),
  },
  // Anthropic
  {
    providerId: "anthropic",
    modelId: "claude-opus-5",
    displayName: "Claude Opus 5",
    capabilities: caps({ reasoning: true, vision: true, contextWindow: 200_000, maxOutputTokens: 64_000 }),
  },
  {
    providerId: "anthropic",
    modelId: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    capabilities: caps({
      reasoning: true,
      vision: true,
      fastEdit: true,
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
    }),
  },
  {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
    displayName: "Claude Sonnet 4.5",
    capabilities: caps({
      reasoning: true,
      vision: true,
      fastEdit: true,
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
    }),
    pricing: price(3, 15, 0.3),
  },
  {
    providerId: "anthropic",
    modelId: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    capabilities: caps({
      vision: true,
      fastEdit: true,
      inexpensive: true,
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
    }),
    pricing: price(1, 5, 0.1),
  },
  // Google
  {
    providerId: "google",
    modelId: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    capabilities: caps({ reasoning: true, vision: true, contextWindow: 1_048_576, maxOutputTokens: 65_536 }),
    pricing: price(1.25, 10),
  },
  {
    providerId: "google",
    modelId: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    capabilities: caps({
      reasoning: true,
      vision: true,
      fastEdit: true,
      inexpensive: true,
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
    }),
    pricing: price(0.3, 2.5),
  },
  {
    providerId: "google",
    modelId: "gemini-2.5-flash-lite",
    displayName: "Gemini 2.5 Flash Lite",
    capabilities: caps({
      vision: true,
      fastEdit: true,
      inexpensive: true,
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
    }),
    pricing: price(0.1, 0.4),
  },
  // xAI
  {
    providerId: "xai",
    modelId: "grok-4",
    displayName: "Grok 4",
    capabilities: caps({ reasoning: true, vision: true, contextWindow: 256_000, maxOutputTokens: 32_768 }),
    pricing: price(3, 15),
  },
  {
    providerId: "xai",
    modelId: "grok-code-fast-1",
    displayName: "Grok Code Fast 1",
    capabilities: caps({
      fastEdit: true,
      inexpensive: true,
      contextWindow: 256_000,
      maxOutputTokens: 32_768,
    }),
    pricing: price(0.2, 1.5),
  },
];

export function catalogModels(providerId?: ProviderId): ModelDescriptor[] {
  return ENTRIES.filter((e) => providerId === undefined || e.providerId === providerId).map((e) => {
    const d: ModelDescriptor = {
      providerId: e.providerId,
      modelId: e.modelId,
      displayName: e.displayName,
      capabilities: e.capabilities,
      source: "catalog",
    };
    if (e.pricing) d.pricing = e.pricing;
    return d;
  });
}

export function catalogEntry(providerId: ProviderId, modelId: string): ModelDescriptor | undefined {
  return catalogModels(providerId).find((m) => m.modelId === modelId);
}

/** Capabilities for a model discovered at runtime but not in the catalog. Conservative on purpose. */
export function defaultCapabilities(local: boolean): ModelCapabilities {
  return caps({ local, inexpensive: local, jsonMode: false, contextWindow: 32_768, maxOutputTokens: 8_192 });
}
