import type { providers as contracts } from "@autoappz/contracts";

export type ProviderId = contracts.ProviderId;
export type ModelDescriptor = contracts.ModelDescriptor;
export type ModelCapabilities = contracts.ModelCapabilities;
export type ModelPricing = contracts.ModelPricing;
export type ProviderConfig = contracts.ProviderConfig;
export type ValidationOutcome = contracts.ValidationOutcome;

/** Provider config with the secret resolved. Exists only inside the main process for the duration of a call. */
export interface ResolvedProviderConfig {
  readonly providerId: ProviderId;
  readonly baseUrl: string | undefined;
  readonly apiKey: string | undefined;
}

export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface ToolCallResult {
  readonly id: string;
  readonly name: string;
  /** JSON-serialisable; adapters stringify for the wire. Already redacted by the caller. */
  readonly output: unknown;
  readonly isError?: boolean;
}

export type ChatMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string; readonly toolCalls?: readonly ToolCallRequest[] }
  | { readonly role: "tool"; readonly results: readonly ToolCallResult[] };

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema (draft-07 compatible) for the tool input. */
  readonly inputSchema: Record<string, unknown>;
}

export interface ChatRequest {
  readonly modelId: string;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolSpec[] | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly temperature?: number | undefined;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number | undefined;
  readonly reasoningTokens?: number | undefined;
}

export type FinishReason = "stop" | "length" | "tool-calls" | "content-filter" | "error" | "other";

/** Uniform streaming vocabulary; adapters translate provider parts into these. */
export type ChatChunk =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "reasoning"; readonly text: string }
  | { readonly type: "tool-call"; readonly call: ToolCallRequest }
  | { readonly type: "finish"; readonly reason: FinishReason; readonly usage: TokenUsage }
  | { readonly type: "error"; readonly message: string; readonly retryable: boolean };

export interface ChatContext {
  readonly signal: AbortSignal;
  /** Transport-level retries for 429/5xx; the agent loop owns higher-level retry policy. */
  readonly maxRetries?: number | undefined;
}

/** One vendor adapter. Only ai-providers imports the AI SDK; nothing here imports Electron or storage. */
export interface ModelProvider {
  readonly id: ProviderId;
  listModels(config: ResolvedProviderConfig, signal?: AbortSignal): Promise<ModelDescriptor[]>;
  validate(config: ResolvedProviderConfig, signal?: AbortSignal): Promise<ValidationOutcome>;
  chat(config: ResolvedProviderConfig, request: ChatRequest, ctx: ChatContext): AsyncIterable<ChatChunk>;
}

/** Minimal fetch shape so adapters are testable without the network. */
export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> | undefined; signal?: AbortSignal | undefined },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;
