/**
 * The only module that imports the Vercel AI SDK (ADR-005). Everything else speaks ChatRequest/ChatChunk.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { jsonSchema, streamText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type {
  ChatChunk,
  ChatMessage,
  ChatRequest,
  FinishReason,
  ResolvedProviderConfig,
  ToolSpec,
} from "./types.ts";

export type SdkKind = "openai" | "anthropic" | "google" | "xai" | "openai-compatible";

export interface SdkOptions {
  /** Custom fetch, e.g. for tests or proxies. */
  readonly fetch?: typeof globalThis.fetch | undefined;
}

export function createLanguageModel(
  kind: SdkKind,
  config: ResolvedProviderConfig,
  modelId: string,
  options: SdkOptions = {},
): LanguageModel {
  const common = {
    ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
    ...(config.baseUrl !== undefined ? { baseURL: config.baseUrl } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  };
  switch (kind) {
    case "openai":
      return createOpenAI(common)(modelId);
    case "anthropic":
      return createAnthropic(common)(modelId);
    case "google":
      return createGoogleGenerativeAI(common)(modelId);
    case "xai":
      return createXai(common)(modelId);
    case "openai-compatible":
      return createOpenAICompatible({
        name: config.providerId,
        baseURL: config.baseUrl ?? "http://127.0.0.1:11434/v1",
        apiKey: config.apiKey ?? "no-key",
        includeUsage: true,
        ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
      })(modelId);
  }
}

export function toModelMessages(messages: readonly ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    switch (m.role) {
      case "system":
        // System text is passed through streamText's `system` option (see systemPromptOf); skipped here.
        break;
      case "user":
        out.push({ role: "user", content: m.content });
        break;
      case "assistant": {
        if (!m.toolCalls || m.toolCalls.length === 0) {
          out.push({ role: "assistant", content: m.content });
        } else {
          out.push({
            role: "assistant",
            content: [
              ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
              ...m.toolCalls.map((c) => ({
                type: "tool-call" as const,
                toolCallId: c.id,
                toolName: c.name,
                input: c.input,
              })),
            ],
          });
        }
        break;
      }
      case "tool":
        out.push({
          role: "tool",
          content: m.results.map((r) => ({
            type: "tool-result" as const,
            toolCallId: r.id,
            toolName: r.name,
            output: r.isError
              ? {
                  type: "error-text" as const,
                  value: typeof r.output === "string" ? r.output : JSON.stringify(r.output),
                }
              : typeof r.output === "string"
                ? { type: "text" as const, value: r.output }
                : { type: "json" as const, value: r.output as never },
          })),
        });
        break;
    }
  }
  return out;
}

/** The SDK takes the system prompt as an option, not as a message; several are joined in order. */
export function systemPromptOf(messages: readonly ChatMessage[]): string | undefined {
  const parts = messages.filter((m) => m.role === "system").map((m) => m.content);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function toToolSet(tools: readonly ToolSpec[] | undefined): ToolSet | undefined {
  if (!tools || tools.length === 0) return undefined;
  const set: ToolSet = {};
  for (const t of tools) {
    // No `execute`: the agent loop runs tools itself under the permission engine.
    set[t.name] = { description: t.description, inputSchema: jsonSchema(t.inputSchema as never) };
  }
  return set;
}

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case "stop":
    case "length":
    case "tool-calls":
    case "content-filter":
    case "error":
      return reason;
    default:
      return "other";
  }
}

/** Streams a chat completion and translates SDK parts into ChatChunk. Errors become chunks, never throws mid-stream. */
export async function* streamChat(
  model: LanguageModel,
  request: ChatRequest,
  signal: AbortSignal,
  options: { maxRetries?: number | undefined } = {},
): AsyncIterable<ChatChunk> {
  if (signal.aborted) {
    yield { type: "error", message: "Cancelled.", retryable: false };
    return;
  }
  const tools = toToolSet(request.tools);
  const system = systemPromptOf(request.messages);
  let result;
  try {
    result = streamText({
      model,
      messages: toModelMessages(request.messages),
      ...(system !== undefined ? { system } : {}),
      maxRetries: options.maxRetries ?? 2,
      ...(tools !== undefined ? { tools } : {}),
      ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      abortSignal: signal,
    });
  } catch (error) {
    yield { type: "error", message: errorMessage(error), retryable: false };
    return;
  }

  try {
    for await (const part of result.stream) {
      switch (part.type) {
        case "text-delta":
          yield { type: "text", text: part.text };
          break;
        case "reasoning-delta":
          yield { type: "reasoning", text: part.text };
          break;
        case "tool-call":
          yield { type: "tool-call", call: { id: part.toolCallId, name: part.toolName, input: part.input } };
          break;
        case "finish":
          yield {
            type: "finish",
            reason: mapFinishReason(part.finishReason),
            usage: {
              inputTokens: part.totalUsage.inputTokens ?? 0,
              outputTokens: part.totalUsage.outputTokens ?? 0,
              cachedInputTokens: part.totalUsage.inputTokenDetails.cacheReadTokens ?? undefined,
              reasoningTokens: part.totalUsage.outputTokenDetails.reasoningTokens ?? undefined,
            },
          };
          break;
        case "error":
          yield { type: "error", message: errorMessage(part.error), retryable: isRetryable(part.error) };
          break;
        case "abort":
          yield { type: "error", message: "Cancelled.", retryable: false };
          break;
        default:
          break;
      }
    }
  } catch (error) {
    if (signal.aborted) yield { type: "error", message: "Cancelled.", retryable: false };
    else yield { type: "error", message: errorMessage(error), retryable: isRetryable(error) };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown provider error";
}

function isRetryable(error: unknown): boolean {
  const status = (error as { statusCode?: number } | undefined)?.statusCode;
  return status === 429 || (status !== undefined && status >= 500);
}
