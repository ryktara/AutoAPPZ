import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { providers as contracts } from "@autoappz/contracts";
import { collect, startFakeModelServer, type FakeModelServer } from "@autoappz/testing";
import {
  GenericProvider,
  PROVIDER_DEFINITIONS,
  ProviderRegistry,
  catalogModels,
  estimateCostUsd,
  estimateTokens,
  formatUsd,
  routeModel,
  type ChatChunk,
  type ModelDescriptor,
  type UsageRecord,
} from "../src/index.ts";

const FIXTURE_KEY = "sk-fixture-provider-key-ABCDEFGHIJKLMNOP";

describe("catalog", () => {
  it("validates against the contract schema and has unique ids per provider", () => {
    const all = catalogModels();
    for (const m of all) expect(contracts.ModelDescriptorSchema.safeParse(m).success).toBe(true);
    const keys = all.map((m) => `${m.providerId}/${m.modelId}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(PROVIDER_DEFINITIONS.map((d) => d.id).sort()).toEqual(
      [...contracts.ProviderIdSchema.options].sort(),
    );
  });
});

describe("cost", () => {
  it("prices cached input separately and rounds", () => {
    const cost = estimateCostUsd(
      { inputTokens: 1_000_000, outputTokens: 100_000, cachedInputTokens: 500_000 },
      { inputPerMillion: 2, outputPerMillion: 8, cachedInputPerMillion: 0.5 },
    );
    expect(cost).toBe(1 + 0.25 + 0.8);
    expect(estimateCostUsd({ inputTokens: 10, outputTokens: 10 }, undefined)).toBe(0);
    expect(estimateTokens("abcd".repeat(10))).toBe(10);
    expect(formatUsd(0.001)).toBe("<$0.01");
    expect(formatUsd(1.234)).toBe("$1.23");
  });
});

describe("router", () => {
  const candidates = catalogModels();
  const policy = contracts.RoutingPolicySchema.parse({});

  it("prefers reasoning models for planning and fast inexpensive ones for classify", () => {
    const plan = routeModel(
      { intent: "planning", complexity: "standard" },
      { candidates, policy, overrides: {} },
    );
    expect(plan?.model.capabilities.reasoning).toBe(true);
    const cls = routeModel(
      { intent: "classify", complexity: "trivial" },
      { candidates, policy, overrides: {} },
    );
    expect(cls?.model.capabilities.inexpensive).toBe(true);
    expect(cls?.reason).toContain("classify");
  });

  it("user overrides always win, global over per-intent", () => {
    const override = { providerId: "google" as const, modelId: "gemini-2.5-flash-lite" };
    const r = routeModel(
      { intent: "planning", complexity: "complex" },
      { candidates, policy, overrides: { planning: override } },
    );
    expect(r?.model.modelId).toBe("gemini-2.5-flash-lite");
    expect(r?.overridden).toBe(true);
    const g = routeModel(
      { intent: "planning", complexity: "complex" },
      {
        candidates,
        policy,
        overrides: { planning: override },
        globalOverride: { providerId: "openai", modelId: "gpt-5" },
      },
    );
    expect(g?.model.modelId).toBe("gpt-5");
  });

  it("local-only privacy filters out cloud models and returns null when nothing fits", () => {
    const localOnly = { ...policy, privacy: "local-only" as const };
    expect(
      routeModel(
        { intent: "coding", complexity: "standard" },
        { candidates, policy: localOnly, overrides: {} },
      ),
    ).toBeNull();
    const local: ModelDescriptor = {
      providerId: "ollama",
      modelId: "qwen3:8b",
      displayName: "qwen3",
      source: "discovered",
      capabilities: { ...candidates[0]!.capabilities, local: true, toolCalling: true },
    };
    const r = routeModel(
      { intent: "coding", complexity: "standard" },
      { candidates: [...candidates, local], policy: localOnly, overrides: {} },
    );
    expect(r?.model.modelId).toBe("qwen3:8b");
  });

  it("is deterministic", () => {
    const a = routeModel({ intent: "coding", complexity: "standard" }, { candidates, policy, overrides: {} });
    const b = routeModel(
      { intent: "coding", complexity: "standard" },
      { candidates: [...candidates].reverse(), policy, overrides: {} },
    );
    expect(a?.model).toEqual(b?.model);
  });
});

describe("GenericProvider against the fake model server", () => {
  let server: FakeModelServer;
  beforeAll(async () => {
    server = await startFakeModelServer({
      apiKey: FIXTURE_KEY,
      models: ["fake-model", "fake-coder"],
      scenarios: [
        { match: "hello", turns: [{ text: "Hello there, builder.", usage: { input: 5, output: 4 } }] },
        {
          match: "weather",
          turns: [
            { text: "Let me check.", toolCalls: [{ name: "get_weather", input: { city: "Oslo" } }] },
            { text: "It is 12°C in Oslo." },
          ],
        },
        { match: "boom", turns: [{ httpError: { status: 500, message: "upstream exploded" } }] },
      ],
    });
  });
  afterAll(async () => {
    await server.close();
  });

  const config = (apiKey: string | undefined) => ({
    providerId: "openai-compatible" as const,
    baseUrl: server.baseUrl,
    apiKey,
  });

  it("validates credentials and discovers models", async () => {
    const p = new GenericProvider("openai-compatible", { now: () => 42 });
    const ok = await p.validate(config(FIXTURE_KEY));
    expect(ok).toEqual({ ok: true, message: "Connected. 2 models available.", modelCount: 2, at: 42 });
    const bad = await p.validate(config("wrong"));
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/rejected/);
    const models = await p.listModels(config(FIXTURE_KEY));
    expect(models.map((m) => m.modelId)).toEqual(["fake-coder", "fake-model"]);
    expect(models[0]?.source).toBe("discovered");
  });

  it("streams text and usage through the SDK adapter", async () => {
    const p = new GenericProvider("openai-compatible");
    const chunks = await collect(
      p.chat(
        config(FIXTURE_KEY),
        { modelId: "fake-model", messages: [{ role: "user", content: "hello" }] },
        { signal: new AbortController().signal },
      ),
    );
    const text = chunks
      .filter((c): c is Extract<ChatChunk, { type: "text" }> => c.type === "text")
      .map((c) => c.text)
      .join("");
    expect(text).toBe("Hello there, builder.");
    const finish = chunks.find((c) => c.type === "finish");
    expect(finish).toMatchObject({
      type: "finish",
      reason: "stop",
      usage: { inputTokens: 5, outputTokens: 4 },
    });
  });

  it("surfaces tool calls without executing them, and accepts tool results on the next turn", async () => {
    const p = new GenericProvider("openai-compatible");
    const tools = [
      {
        name: "get_weather",
        description: "weather",
        inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      },
    ];
    const first = await collect(
      p.chat(
        config(FIXTURE_KEY),
        { modelId: "fake-model", tools, messages: [{ role: "user", content: "weather?" }] },
        { signal: new AbortController().signal },
      ),
    );
    const call = first.find((c): c is Extract<ChatChunk, { type: "tool-call" }> => c.type === "tool-call");
    expect(call?.call).toMatchObject({ name: "get_weather", input: { city: "Oslo" } });
    expect(first.find((c) => c.type === "finish")).toMatchObject({ reason: "tool-calls" });

    const second = await collect(
      p.chat(
        config(FIXTURE_KEY),
        {
          modelId: "fake-model",
          tools,
          messages: [
            { role: "user", content: "weather?" },
            { role: "assistant", content: "Let me check.", toolCalls: [call!.call] },
            { role: "tool", results: [{ id: call!.call.id, name: "get_weather", output: { tempC: 12 } }] },
          ],
        },
        { signal: new AbortController().signal },
      ),
    );
    expect(
      second
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join(""),
    ).toBe("It is 12°C in Oslo.");
    const sent = server.requests.at(-1)?.body as { messages: { role: string }[] };
    expect(sent.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
  });

  it("turns HTTP failures into error chunks and cancellation into a cancelled chunk", async () => {
    const p = new GenericProvider("openai-compatible");
    const chunks = await collect(
      p.chat(
        config(FIXTURE_KEY),
        { modelId: "fake-model", messages: [{ role: "user", content: "boom" }] },
        { signal: new AbortController().signal, maxRetries: 0 },
      ),
    );
    expect(chunks.some((c) => c.type === "error" && c.retryable)).toBe(true);
    const ac = new AbortController();
    ac.abort();
    const cancelled = await collect(
      p.chat(
        config(FIXTURE_KEY),
        { modelId: "fake-model", messages: [{ role: "user", content: "hello" }] },
        { signal: ac.signal },
      ),
    );
    expect(cancelled.at(-1)).toMatchObject({ type: "error", message: "Cancelled." });
  });

  it("registry resolves secrets per call, records usage, and never leaks the key into public state", async () => {
    let settings = contracts.ProviderSettingsSchema.parse({});
    const usage: UsageRecord[] = [];
    const registry = new ProviderRegistry({
      settings: {
        get: () => settings,
        set: (n) => {
          settings = n;
        },
      },
      resolveSecret: (id) => Promise.resolve(id === "sec_1" ? FIXTURE_KEY : undefined),
      usage: { record: (u) => usage.push(u) },
      now: () => 7,
      newId: () => "use_1",
    });
    expect(registry.status("openai-compatible").ready).toBe(false);
    registry.configure({
      providerId: "openai-compatible",
      enabled: true,
      baseUrl: server.baseUrl,
      credentialId: "sec_1",
    });
    expect(registry.status("openai-compatible").ready).toBe(true);
    const v = await registry.validate("openai-compatible");
    expect(v.ok).toBe(true);
    expect(registry.models("openai-compatible").map((m) => m.modelId)).toEqual(["fake-coder", "fake-model"]);

    const chunks = await collect(
      registry.chat(
        { providerId: "openai-compatible", modelId: "fake-model" },
        { messages: [{ role: "user", content: "hello" }] },
        { signal: new AbortController().signal, taskId: "t1" },
      ),
    );
    expect(chunks.some((c) => c.type === "text")).toBe(true);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      id: "use_1",
      taskId: "t1",
      providerId: "openai-compatible",
      modelId: "fake-model",
      estimatedCostUsd: 0,
      at: 7,
    });
    expect(usage[0]?.usage).toMatchObject({ inputTokens: 5, outputTokens: 4 });

    expect(JSON.stringify([registry.list(), registry.getSettings(), registry.models()])).not.toContain(
      FIXTURE_KEY,
    );
    const route = registry.route({ intent: "coding", complexity: "standard" });
    expect(route?.model.providerId).toBe("openai-compatible");
    await expect(
      collect(
        registry.chat(
          { providerId: "openai", modelId: "gpt-5" },
          { messages: [] },
          { signal: new AbortController().signal },
        ),
      ),
    ).rejects.toMatchObject({ code: "providers.not_ready" });
  });
});
