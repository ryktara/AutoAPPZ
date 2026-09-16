import { z } from "zod";
import { defineCommand, defineQuery } from "../definitions.ts";

export const ProviderIdSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "xai",
  "openai-compatible",
  "ollama",
]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/** Capability descriptors (ADR-005). Booleans are deliberately coarse; limits are numeric. */
export const ModelCapabilitiesSchema = z.object({
  reasoning: z.boolean(),
  fastEdit: z.boolean(),
  vision: z.boolean(),
  largeContext: z.boolean(),
  toolCalling: z.boolean(),
  local: z.boolean(),
  inexpensive: z.boolean(),
  jsonMode: z.boolean(),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

/** USD per million tokens. Catalog values are estimates and always labelled as such in the UI. */
export const ModelPricingSchema = z.object({
  inputPerMillion: z.number().nonnegative(),
  outputPerMillion: z.number().nonnegative(),
  cachedInputPerMillion: z.number().nonnegative().optional(),
});
export type ModelPricing = z.infer<typeof ModelPricingSchema>;

export const ModelDescriptorSchema = z.object({
  providerId: ProviderIdSchema,
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  capabilities: ModelCapabilitiesSchema,
  pricing: ModelPricingSchema.optional(),
  source: z.enum(["catalog", "discovered", "user"]),
});
export type ModelDescriptor = z.infer<typeof ModelDescriptorSchema>;

export const ProviderConfigSchema = z.object({
  providerId: ProviderIdSchema,
  enabled: z.boolean().default(false),
  /** SecretRef id holding the API key. Never the key itself. */
  credentialId: z.string().min(1).optional(),
  baseUrl: z.url().optional(),
  defaultModelId: z.string().min(1).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ValidationOutcomeSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  modelCount: z.number().int().nonnegative(),
  at: z.number().int().nonnegative(),
});
export type ValidationOutcome = z.infer<typeof ValidationOutcomeSchema>;

export const ProviderStatusSchema = z.object({
  providerId: ProviderIdSchema,
  displayName: z.string(),
  requiresApiKey: z.boolean(),
  supportsBaseUrl: z.boolean(),
  defaultBaseUrl: z.string().optional(),
  docsUrl: z.string(),
  config: ProviderConfigSchema,
  /** Enabled and (key present or not required). */
  ready: z.boolean(),
  lastValidation: ValidationOutcomeSchema.optional(),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export const RoutingIntentSchema = z.enum([
  "planning",
  "coding",
  "fastEdit",
  "review",
  "debug",
  "summarize",
  "classify",
]);
export type RoutingIntent = z.infer<typeof RoutingIntentSchema>;

export const ComplexitySchema = z.enum(["trivial", "standard", "complex"]);
export type Complexity = z.infer<typeof ComplexitySchema>;

export const RoutingPolicySchema = z.object({
  privacy: z.enum(["any", "local-only"]).default("any"),
  /** 0 = ignore cost, 1 = cheapest wins ties. */
  costWeight: z.number().min(0).max(1).default(0.5),
  latencyWeight: z.number().min(0).max(1).default(0.3),
});
export type RoutingPolicy = z.infer<typeof RoutingPolicySchema>;

export const ModelRefSchema = z.object({ providerId: ProviderIdSchema, modelId: z.string().min(1) });
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const ProviderSettingsSchema = z.object({
  providers: z.array(ProviderConfigSchema).default([]),
  policy: RoutingPolicySchema.prefault({}),
  /** Explicit user choice per intent; always wins over routing. */
  overrides: z.partialRecord(RoutingIntentSchema, ModelRefSchema).default({}),
  /** Explicit user choice for everything; wins over per-intent overrides. */
  globalOverride: ModelRefSchema.optional(),
});
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

export const providersList = defineQuery({
  name: "providers.list",
  input: z.void(),
  output: z.array(ProviderStatusSchema),
  scope: "providers",
});

export const providersConfigure = defineCommand({
  name: "providers.configure",
  input: z.object({
    providerId: ProviderIdSchema,
    enabled: z.boolean().optional(),
    /** null clears the credential; the SecretRef itself is deleted by secrets.delete. */
    credentialId: z.string().min(1).nullable().optional(),
    baseUrl: z.url().nullable().optional(),
    defaultModelId: z.string().min(1).nullable().optional(),
  }),
  output: ProviderStatusSchema,
  invalidates: ["providers", "models", "routing"],
});

/** Contacts the provider with the stored credential; never returns the key. */
export const providersValidate = defineCommand({
  name: "providers.validate",
  input: z.object({ providerId: ProviderIdSchema }),
  output: ValidationOutcomeSchema,
  invalidates: ["providers", "models", "routing"],
});

export const providersModels = defineQuery({
  name: "providers.models",
  input: z.object({ providerId: ProviderIdSchema.optional(), onlyReady: z.boolean().default(true) }),
  output: z.array(ModelDescriptorSchema),
  scope: "models",
});

export const providersSettingsGet = defineQuery({
  name: "providers.settings.get",
  input: z.void(),
  output: ProviderSettingsSchema,
  scope: "providers",
});

export const providersSettingsUpdate = defineCommand({
  name: "providers.settings.update",
  input: z.object({
    policy: RoutingPolicySchema.partial().optional(),
    overrides: z.partialRecord(RoutingIntentSchema, ModelRefSchema.nullable()).optional(),
    globalOverride: ModelRefSchema.nullable().optional(),
  }),
  output: ProviderSettingsSchema,
  invalidates: ["providers", "routing"],
});

export const RouteDecisionSchema = z.object({
  model: ModelDescriptorSchema,
  reason: z.string(),
  candidates: z.number().int().nonnegative(),
  overridden: z.boolean(),
});
export type RouteDecision = z.infer<typeof RouteDecisionSchema>;

/** Dry-run of the router so the UI can show "which model would handle this". */
export const providersRoute = defineQuery({
  name: "providers.route",
  input: z.object({ intent: RoutingIntentSchema, complexity: ComplexitySchema.default("standard") }),
  output: RouteDecisionSchema.nullable(),
  scope: "routing",
});

export const UsageSummarySchema = z.object({
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  byModel: z.array(
    z.object({
      providerId: ProviderIdSchema,
      modelId: z.string(),
      calls: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      estimatedCostUsd: z.number().nonnegative(),
    }),
  ),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

export const usageSummary = defineQuery({
  name: "usage.summary",
  input: z.object({ projectId: z.string().min(1).optional(), taskId: z.string().min(1).optional() }),
  output: UsageSummarySchema,
  scope: "usage",
});
