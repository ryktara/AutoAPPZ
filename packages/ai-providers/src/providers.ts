import { catalogEntry, catalogModels, defaultCapabilities } from "./catalog.ts";
import { createLanguageModel, streamChat, type SdkKind } from "./sdk.ts";
import type {
  ChatChunk,
  ChatContext,
  ChatRequest,
  FetchLike,
  ModelDescriptor,
  ModelProvider,
  ProviderId,
  ResolvedProviderConfig,
  ValidationOutcome,
} from "./types.ts";

export interface ProviderDefinition {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly sdk: SdkKind;
  readonly requiresApiKey: boolean;
  readonly supportsBaseUrl: boolean;
  readonly defaultBaseUrl: string | undefined;
  readonly docsUrl: string;
  readonly discovery: "openai" | "anthropic" | "google" | "ollama";
  readonly local: boolean;
}

/** All providers are equal cards in the UI; none is privileged (product principle). */
export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    sdk: "openai",
    requiresApiKey: true,
    supportsBaseUrl: false,
    defaultBaseUrl: undefined,
    docsUrl: "https://platform.openai.com/api-keys",
    discovery: "openai",
    local: false,
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    sdk: "anthropic",
    requiresApiKey: true,
    supportsBaseUrl: false,
    defaultBaseUrl: undefined,
    docsUrl: "https://console.anthropic.com/settings/keys",
    discovery: "anthropic",
    local: false,
  },
  {
    id: "google",
    displayName: "Google",
    sdk: "google",
    requiresApiKey: true,
    supportsBaseUrl: false,
    defaultBaseUrl: undefined,
    docsUrl: "https://aistudio.google.com/app/apikey",
    discovery: "google",
    local: false,
  },
  {
    id: "xai",
    displayName: "xAI",
    sdk: "xai",
    requiresApiKey: true,
    supportsBaseUrl: false,
    defaultBaseUrl: undefined,
    docsUrl: "https://console.x.ai/",
    discovery: "openai",
    local: false,
  },
  {
    id: "openai-compatible",
    displayName: "OpenAI-compatible",
    sdk: "openai-compatible",
    requiresApiKey: false,
    supportsBaseUrl: true,
    defaultBaseUrl: "http://127.0.0.1:1234/v1",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    discovery: "openai",
    local: false,
  },
  {
    id: "ollama",
    displayName: "Ollama",
    sdk: "openai-compatible",
    requiresApiKey: false,
    supportsBaseUrl: true,
    defaultBaseUrl: "http://127.0.0.1:11434",
    docsUrl: "https://ollama.com/download",
    discovery: "ollama",
    local: true,
  },
];

export function providerDefinition(id: ProviderId): ProviderDefinition {
  const def = PROVIDER_DEFINITIONS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown provider ${id}`);
  return def;
}

const DISCOVERY_ENDPOINTS: Record<ProviderId, string | undefined> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  xai: "https://api.x.ai/v1",
  "openai-compatible": undefined,
  ollama: undefined,
};

export interface GenericProviderOptions {
  readonly fetch?: FetchLike | undefined;
  readonly now?: (() => number) | undefined;
}

/**
 * One implementation serves every vendor: discovery/validation via small REST calls, chat via the SDK.
 * Provider-specific behaviour is data in ProviderDefinition, not code paths.
 */
export class GenericProvider implements ModelProvider {
  readonly id: ProviderId;
  private readonly def: ProviderDefinition;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(id: ProviderId, options: GenericProviderOptions = {}) {
    this.id = id;
    this.def = providerDefinition(id);
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.now = options.now ?? Date.now;
  }

  async listModels(config: ResolvedProviderConfig, signal?: AbortSignal): Promise<ModelDescriptor[]> {
    const discovered = await this.discover(config, signal);
    const catalog = catalogModels(this.id);
    if (discovered === undefined) return catalog;
    const byId = new Map(catalog.map((m) => [m.modelId, m]));
    const out: ModelDescriptor[] = [];
    for (const id of discovered) {
      const known = byId.get(id);
      out.push(
        known ?? {
          providerId: this.id,
          modelId: id,
          displayName: id,
          capabilities: defaultCapabilities(this.def.local),
          source: "discovered",
        },
      );
    }
    // Catalog models the listing did not mention stay available (some APIs only list a subset).
    for (const m of catalog) if (!discovered.includes(m.modelId)) out.push(m);
    return out;
  }

  async validate(config: ResolvedProviderConfig, signal?: AbortSignal): Promise<ValidationOutcome> {
    const at = this.now();
    if (this.def.requiresApiKey && !config.apiKey) {
      return { ok: false, message: "No API key configured.", modelCount: 0, at };
    }
    try {
      const discovered = await this.discover(config, signal);
      const count = discovered?.length ?? catalogModels(this.id).length;
      if (discovered?.length === 0) {
        return {
          ok: true,
          message: this.def.local
            ? "Connected, but no models are installed yet."
            : "Connected; no models listed.",
          modelCount: 0,
          at,
        };
      }
      return {
        ok: true,
        message: `Connected. ${String(count)} model${count === 1 ? "" : "s"} available.`,
        modelCount: count,
        at,
      };
    } catch (error) {
      return { ok: false, message: describeError(error), modelCount: 0, at };
    }
  }

  chat(config: ResolvedProviderConfig, request: ChatRequest, ctx: ChatContext): AsyncIterable<ChatChunk> {
    const chatConfig =
      this.def.discovery === "ollama" ? { ...config, baseUrl: `${baseUrl(config, this.def)}/v1` } : config;
    const model = createLanguageModel(this.def.sdk, chatConfig, request.modelId);
    return streamChat(model, request, ctx.signal, { maxRetries: ctx.maxRetries });
  }

  /** Model ids from the provider, or undefined when the provider has no listing endpoint reachable. */
  private async discover(
    config: ResolvedProviderConfig,
    signal?: AbortSignal,
  ): Promise<string[] | undefined> {
    const base = baseUrl(config, this.def);
    const opts = { signal };
    switch (this.def.discovery) {
      case "openai": {
        const res = await this.fetchImpl(`${base}/models`, { ...opts, headers: authHeaders(config) });
        await assertOk(res);
        const body = (await res.json()) as { data?: { id: string }[] };
        return (body.data ?? []).map((m) => m.id).sort();
      }
      case "anthropic": {
        const res = await this.fetchImpl(`${base}/models?limit=100`, {
          ...opts,
          headers: { "x-api-key": config.apiKey ?? "", "anthropic-version": "2023-06-01" },
        });
        await assertOk(res);
        const body = (await res.json()) as { data?: { id: string }[] };
        return (body.data ?? []).map((m) => m.id).sort();
      }
      case "google": {
        const res = await this.fetchImpl(`${base}/models?pageSize=200`, {
          ...opts,
          headers: { "x-goog-api-key": config.apiKey ?? "" },
        });
        await assertOk(res);
        const body = (await res.json()) as { models?: { name: string }[] };
        return (body.models ?? []).map((m) => m.name.replace(/^models\//, "")).sort();
      }
      case "ollama": {
        const res = await this.fetchImpl(`${base}/api/tags`, opts);
        await assertOk(res);
        const body = (await res.json()) as { models?: { name: string }[] };
        return (body.models ?? []).map((m) => m.name).sort();
      }
    }
  }
}

function baseUrl(config: ResolvedProviderConfig, def: ProviderDefinition): string {
  const url = config.baseUrl ?? def.defaultBaseUrl ?? DISCOVERY_ENDPOINTS[def.id];
  if (!url) throw new Error(`Provider ${def.id} has no base URL`);
  return url.replace(/\/+$/, "");
}

function authHeaders(config: ResolvedProviderConfig): Record<string, string> {
  return config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
}

async function assertOk(res: { ok: boolean; status: number; text(): Promise<string> }): Promise<void> {
  if (res.ok) return;
  const detail = (await res.text().catch(() => "")).slice(0, 200);
  if (res.status === 401 || res.status === 403)
    throw new ProviderHttpError(res.status, "The API key was rejected.");
  if (res.status === 404) throw new ProviderHttpError(res.status, "Endpoint not found. Check the base URL.");
  throw new ProviderHttpError(res.status, `HTTP ${String(res.status)}${detail ? `: ${detail}` : ""}`);
}

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

function describeError(error: unknown): string {
  if (error instanceof ProviderHttpError) return error.message;
  if (error instanceof Error) {
    if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(error.message))
      return "Could not connect. Is the server running and the base URL correct?";
    return error.message;
  }
  return "Unknown error";
}

export { catalogEntry };
