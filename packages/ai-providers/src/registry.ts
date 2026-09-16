import { AppError, providers as contracts } from "@autoappz/contracts";
import type { Logger } from "@autoappz/diagnostics";
import { catalogModels } from "./catalog.ts";
import { estimateCostUsd } from "./cost.ts";
import { GenericProvider, PROVIDER_DEFINITIONS, providerDefinition } from "./providers.ts";
import { routeModel, type RouteRequest } from "./router.ts";
import type {
  ChatChunk,
  ChatRequest,
  FetchLike,
  ModelDescriptor,
  ModelProvider,
  ProviderId,
  ResolvedProviderConfig,
  TokenUsage,
} from "./types.ts";

type ProviderSettings = contracts.ProviderSettings;
type ProviderConfig = contracts.ProviderConfig;
type ProviderStatus = contracts.ProviderStatus;
type ValidationOutcome = contracts.ValidationOutcome;
type RouteDecision = contracts.RouteDecision;

/** Persistence of provider settings; implemented by the desktop over the settings table. */
export interface ProviderSettingsStore {
  get(): ProviderSettings;
  set(next: ProviderSettings): void;
}

export interface UsageRecord {
  readonly id: string;
  readonly taskId: string | undefined;
  readonly providerId: ProviderId;
  readonly modelId: string;
  readonly usage: TokenUsage;
  readonly estimatedCostUsd: number;
  readonly at: number;
}

export interface UsageRecorder {
  record(entry: UsageRecord): void;
}

export interface ProviderRegistryOptions {
  settings: ProviderSettingsStore;
  /** Resolves a SecretRef id to its value, main-process only. */
  resolveSecret: (id: string) => Promise<string | undefined>;
  usage: UsageRecorder;
  logger?: Logger | undefined;
  fetch?: FetchLike | undefined;
  now?: (() => number) | undefined;
  newId?: (() => string) | undefined;
  /** Transport retries for 429/5xx per chat call (default 2). */
  maxRetries?: number | undefined;
  /** Test seam: replace adapters. */
  createProvider?: ((id: ProviderId) => ModelProvider) | undefined;
}

export interface ChatCallContext {
  readonly signal: AbortSignal;
  readonly taskId?: string | undefined;
}

/**
 * Owns provider configuration, credential resolution, discovery cache, routing and usage accounting.
 * Secrets are resolved per call and never stored on the registry.
 */
export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, ModelProvider>();
  private readonly discovered = new Map<ProviderId, ModelDescriptor[]>();
  private readonly lastValidation = new Map<ProviderId, ValidationOutcome>();
  private readonly settings: ProviderSettingsStore;
  private readonly resolveSecret: (id: string) => Promise<string | undefined>;
  private readonly usage: UsageRecorder;
  private readonly log: Logger | undefined;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly maxRetries: number | undefined;

  constructor(options: ProviderRegistryOptions) {
    this.settings = options.settings;
    this.resolveSecret = options.resolveSecret;
    this.usage = options.usage;
    this.log = options.logger;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? defaultId;
    this.maxRetries = options.maxRetries;
    const create =
      options.createProvider ??
      ((id: ProviderId) => new GenericProvider(id, { fetch: options.fetch, now: options.now }));
    for (const def of PROVIDER_DEFINITIONS) this.providers.set(def.id, create(def.id));
  }

  // ---------------------------------------------------------------- configuration

  list(): ProviderStatus[] {
    return PROVIDER_DEFINITIONS.map((def) => this.status(def.id));
  }

  status(id: ProviderId): ProviderStatus {
    const def = providerDefinition(id);
    const config = this.configFor(id);
    const status: ProviderStatus = {
      providerId: id,
      displayName: def.displayName,
      requiresApiKey: def.requiresApiKey,
      supportsBaseUrl: def.supportsBaseUrl,
      docsUrl: def.docsUrl,
      config,
      ready: config.enabled && (!def.requiresApiKey || config.credentialId !== undefined),
    };
    if (def.defaultBaseUrl !== undefined) status.defaultBaseUrl = def.defaultBaseUrl;
    const v = this.lastValidation.get(id);
    if (v) status.lastValidation = v;
    return status;
  }

  configure(input: {
    providerId: ProviderId;
    enabled?: boolean | undefined;
    credentialId?: string | null | undefined;
    baseUrl?: string | null | undefined;
    defaultModelId?: string | null | undefined;
  }): ProviderStatus {
    const current = this.settings.get();
    const existing = this.configFor(input.providerId);
    const next: ProviderConfig = { providerId: input.providerId, enabled: input.enabled ?? existing.enabled };
    const credentialId =
      input.credentialId === undefined ? existing.credentialId : (input.credentialId ?? undefined);
    const baseUrl = input.baseUrl === undefined ? existing.baseUrl : (input.baseUrl ?? undefined);
    const defaultModelId =
      input.defaultModelId === undefined ? existing.defaultModelId : (input.defaultModelId ?? undefined);
    if (credentialId !== undefined) next.credentialId = credentialId;
    if (baseUrl !== undefined) next.baseUrl = baseUrl;
    if (defaultModelId !== undefined) next.defaultModelId = defaultModelId;
    const connectionChanged = input.credentialId !== undefined || input.baseUrl !== undefined;
    if (!connectionChanged && existing.discoveredModels) next.discoveredModels = existing.discoveredModels;
    this.settings.set({
      ...current,
      providers: [...current.providers.filter((p) => p.providerId !== input.providerId), next],
    });
    if (input.credentialId !== undefined || input.baseUrl !== undefined) {
      this.discovered.delete(input.providerId);
      this.lastValidation.delete(input.providerId);
    }
    return this.status(input.providerId);
  }

  getSettings(): ProviderSettings {
    return this.settings.get();
  }

  updateSettings(input: {
    policy?: { [K in keyof contracts.RoutingPolicy]?: contracts.RoutingPolicy[K] | undefined } | undefined;
    overrides?: Partial<Record<contracts.RoutingIntent, contracts.ModelRef | null>> | undefined;
    globalOverride?: contracts.ModelRef | null | undefined;
  }): ProviderSettings {
    const current = this.settings.get();
    const merged: Record<string, contracts.ModelRef | null | undefined> = {
      ...current.overrides,
      ...input.overrides,
    };
    const overrides = Object.fromEntries(
      Object.entries(merged).filter((entry): entry is [string, contracts.ModelRef] => entry[1] != null),
    ) as ProviderSettings["overrides"];
    const next: ProviderSettings = {
      providers: current.providers,
      policy: contracts.RoutingPolicySchema.parse({
        ...current.policy,
        ...stripUndefined(input.policy ?? {}),
      }),
      overrides,
    };
    const global =
      input.globalOverride === undefined ? current.globalOverride : (input.globalOverride ?? undefined);
    if (global !== undefined) next.globalOverride = global;
    this.settings.set(next);
    return next;
  }

  // ---------------------------------------------------------------- discovery + validation

  async validate(id: ProviderId, signal?: AbortSignal): Promise<ValidationOutcome> {
    const provider = this.provider(id);
    const config = await this.resolve(id);
    const outcome = await provider.validate(config, signal);
    this.lastValidation.set(id, outcome);
    if (outcome.ok) {
      try {
        const models = await provider.listModels(config, signal);
        this.discovered.set(id, models);
        this.persistDiscovered(id, models);
      } catch (error) {
        this.log?.warn("model discovery failed after validation", {
          providerId: id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.log?.info("provider validated", { providerId: id, ok: outcome.ok, modelCount: outcome.modelCount });
    return outcome;
  }

  /** Models for a provider: discovered list when available, otherwise the catalog. */
  models(id?: ProviderId, onlyReady = true): ModelDescriptor[] {
    const ids = id ? [id] : PROVIDER_DEFINITIONS.map((d) => d.id);
    const out: ModelDescriptor[] = [];
    for (const pid of ids) {
      if (onlyReady && !this.status(pid).ready) continue;
      out.push(...(this.discovered.get(pid) ?? this.configFor(pid).discoveredModels ?? catalogModels(pid)));
    }
    return out;
  }

  // ---------------------------------------------------------------- routing

  route(request: RouteRequest): RouteDecision | null {
    const s = this.settings.get();
    return routeModel(request, {
      candidates: this.models(undefined, true),
      policy: s.policy,
      overrides: s.overrides,
      globalOverride: s.globalOverride,
    });
  }

  // ---------------------------------------------------------------- chat

  /** Streams a chat call and records usage when it finishes. Secrets are resolved here and go no further. */
  async *chat(
    ref: contracts.ModelRef,
    request: Omit<ChatRequest, "modelId">,
    ctx: ChatCallContext,
  ): AsyncIterable<ChatChunk> {
    if (!this.status(ref.providerId).ready) {
      throw new AppError(
        "precondition",
        "providers.not_ready",
        `Provider ${ref.providerId} is not configured.`,
      );
    }
    const provider = this.provider(ref.providerId);
    const config = await this.resolve(ref.providerId);
    const descriptor = this.models(ref.providerId, false).find((m) => m.modelId === ref.modelId);
    for await (const chunk of provider.chat(
      config,
      { ...request, modelId: ref.modelId },
      { signal: ctx.signal, maxRetries: this.maxRetries },
    )) {
      if (chunk.type === "finish") {
        this.usage.record({
          id: this.newId(),
          taskId: ctx.taskId,
          providerId: ref.providerId,
          modelId: ref.modelId,
          usage: chunk.usage,
          estimatedCostUsd: estimateCostUsd(chunk.usage, descriptor?.pricing),
          at: this.now(),
        });
      }
      yield chunk;
    }
  }

  // ---------------------------------------------------------------- internals

  private provider(id: ProviderId): ModelProvider {
    const p = this.providers.get(id);
    if (!p) throw new AppError("not_found", "providers.unknown", `Unknown provider ${id}`);
    return p;
  }

  private persistDiscovered(id: ProviderId, models: ModelDescriptor[]): void {
    const current = this.settings.get();
    const existing = this.configFor(id);
    this.settings.set({
      ...current,
      providers: [
        ...current.providers.filter((p) => p.providerId !== id),
        { ...existing, discoveredModels: models },
      ],
    });
  }

  private configFor(id: ProviderId): ProviderConfig {
    return (
      this.settings.get().providers.find((p) => p.providerId === id) ?? { providerId: id, enabled: false }
    );
  }

  private async resolve(id: ProviderId): Promise<ResolvedProviderConfig> {
    const config = this.configFor(id);
    const apiKey = config.credentialId ? await this.resolveSecret(config.credentialId) : undefined;
    return { providerId: id, baseUrl: config.baseUrl, apiKey };
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

function defaultId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = "use_";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
