import type { SecretRef } from "@autoappz/contracts";

export interface ModelCapabilities {
  readonly toolCalling: boolean;
  readonly structuredOutput: boolean;
  readonly vision: boolean;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly streaming: boolean;
}

export interface ModelDescriptor {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly capabilities: ModelCapabilities;
  /** USD per million tokens; undefined when unknown (local models). */
  readonly pricing?: { readonly inputPerM: number; readonly outputPerM: number };
  readonly local: boolean;
}

export interface ProviderConfig {
  readonly providerId: string;
  readonly baseUrl?: string;
  readonly credential?: SecretRef;
}

export interface UsageSummary {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
}

/** Adapter over one vendor SDK. Concrete adapters arrive in M3. */
export interface ModelProvider {
  readonly id: string;
  listModels(): Promise<readonly ModelDescriptor[]>;
  probe(): Promise<{ ok: boolean; message?: string }>;
}

export type RoutingIntent = "planning" | "coding" | "review" | "summarize" | "classify" | "embed";

export interface RoutingRequest {
  readonly intent: RoutingIntent;
  readonly requires: Partial<ModelCapabilities>;
  readonly minContext?: number;
  readonly preferLocal?: boolean;
  readonly budgetUsd?: number;
}

export interface ModelRouter {
  select(request: RoutingRequest): Promise<{ model: ModelDescriptor; reason: string }>;
}
