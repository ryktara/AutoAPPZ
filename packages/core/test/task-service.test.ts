import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProviderRegistry, type UsageRecord } from "@autoappz/ai-providers";
import { providers as providerContracts, tasks as taskContracts } from "@autoappz/contracts";
import {
  MessagesRepository,
  ProjectsRepository,
  SessionsRepository,
  TaskChangesRepository,
  TaskEventsRepository,
  TasksRepository,
  UsageRecordsRepository,
  openDatabase,
} from "@autoappz/storage";
import { collect, startFakeModelServer, type FakeModelServer } from "@autoappz/testing";
import { Redactor } from "@autoappz/diagnostics";
import { PermissionEngine } from "@autoappz/permissions";
import { FS_TOOLS, ToolRuntime, createSearchTool } from "@autoappz/tools";
import { ChangeTracker, TaskEventHub, TaskService } from "../src/index.ts";

let server: FakeModelServer;
beforeAll(async () => {
  server = await startFakeModelServer({
    scenarios: [
      {
        match: "slow",
        turns: [{ text: "one two three four five six seven eight nine ten", chunkDelayMs: 40 }],
      },
      { match: "fail", turns: [{ httpError: { status: 500, message: "upstream down" } }] },
      { match: /.*/, turns: [{ text: "The answer is 42.", usage: { input: 20, output: 6 } }] },
    ],
  });
});
afterAll(async () => {
  await server.close();
});

async function boot(approval: "none" | "trivial" | "standard" = "none", projectPath = "/x/shop") {
  const h = openDatabase({ path: ":memory:" });
  new ProjectsRepository(h.db).insert({
    id: "p1",
    name: "Shop",
    path: projectPath,
    origin: "created",
    runtimeProfile: "host",
    createdAt: 1,
    lastOpenedAt: 1,
  });
  let settings = providerContracts.ProviderSettingsSchema.parse({
    providers: [{ providerId: "openai-compatible", enabled: true, baseUrl: server.baseUrl }],
  });
  const usageRepo = new UsageRecordsRepository(h.db);
  const usage: UsageRecord[] = [];
  const registry = new ProviderRegistry({
    settings: {
      get: () => settings,
      set: (n) => {
        settings = n;
      },
    },
    resolveSecret: () => Promise.resolve(undefined),
    maxRetries: 0,
    usage: {
      record: (u) => {
        usage.push(u);
        usageRepo.insert({
          id: u.id,
          taskId: u.taskId,
          providerId: u.providerId,
          modelId: u.modelId,
          inputTokens: u.usage.inputTokens,
          outputTokens: u.usage.outputTokens,
          estimatedCostUsd: u.estimatedCostUsd,
          at: u.at,
        });
      },
    },
  });
  await registry.validate("openai-compatible");
  let n = 0;
  const changesRepo = new TaskChangesRepository(h.db);
  const permissions = new PermissionEngine({
    store: { list: () => [], insert: () => undefined, delete: () => false },
    consentTimeoutMs: 200,
  });
  const tools = new ToolRuntime({
    tools: [...FS_TOOLS, createSearchTool()],
    permissions,
    audit: { record: () => undefined },
    redactor: new Redactor(),
  });
  const service = new TaskService({
    tasks: new TasksRepository(h.db),
    events: new TaskEventsRepository(h.db),
    sessions: new SessionsRepository(h.db),
    messages: new MessagesRepository(h.db),
    usage: usageRepo,
    providers: registry,
    tools,
    changes: new ChangeTracker(changesRepo, () => 5),
    context: {
      project: () => ({
        id: "p1",
        name: "Shop",
        path: projectPath,
        origin: "created",
        runtimeProfile: "host",
        createdAt: 1,
        lastOpenedAt: 1,
      }),
      memory: () => [],
      blueprint: () => null,
      approvalThreshold: () => approval,
    },
    newId: (p) => `${p}_${String(++n).padStart(3, "0")}`,
    hub: new TaskEventHub({ batchMs: 0 }),
  });
  return {
    h,
    service,
    registry,
    permissions,
    changesRepo,
    usage,
    events: new TaskEventsRepository(h.db),
    messages: new MessagesRepository(h.db),
  };
}

const untilDone = (service: TaskService, taskId: string) =>
  collect(service.stream(taskId, new AbortController().signal));

describe("TaskService (ask)", () => {
  it("refuses to submit without a ready provider", async () => {
    const { service, registry } = await boot();
    registry.configure({ providerId: "openai-compatible", enabled: false });
    expect(() => service.submit({ projectId: "p1", request: "hi", mode: "ask" })).toThrow(
      /No model provider/,
    );
  });

  it("streams the answer, persists messages, journals transitions and records cost", async () => {
    const { service, events, messages } = await boot();
    const changes: string[] = [];
    service.onChange((c) => changes.push(c.state));
    const { taskId, sessionId } = service.submit({
      projectId: "p1",
      request: "What is the answer?",
      mode: "ask",
    });
    const chunks = await untilDone(service, taskId);
    expect(chunks.find((c) => c.kind === "text")).toBeDefined();

    const kinds = chunks.map((c) => c.kind).filter((k, i, arr) => !(k === "text" && arr[i - 1] === "text"));
    expect(kinds).toEqual(["state", "model", "state", "text", "usage", "state", "done"]);
    expect(
      chunks
        .filter((c) => c.kind === "text")
        .map((c) => (c as { delta: string }).delta)
        .join(""),
    ).toBe("The answer is 42.");
    const task = service.get(taskId);
    expect(task.state).toBe("COMPLETE");
    expect(task.cost).toEqual({ calls: 1, inputTokens: 20, outputTokens: 6, estimatedCostUsd: 0 });
    expect(task.model?.providerId).toBe("openai-compatible");
    expect(messages.list(sessionId).map((m) => [m.role, m.content, m.partial])).toEqual([
      ["user", "What is the answer?", false],
      ["assistant", "The answer is 42.", false],
    ]);
    expect(events.list(taskId).map((e) => `${e.event}:${e.toState}`)).toEqual([
      "submit:UNDERSTAND",
      "context_sufficient:EXECUTE",
      "answered:COMPLETE",
    ]);
    expect(changes).toEqual(["UNDERSTAND", "EXECUTE", "COMPLETE"]);

    // late subscriber replays the terminal picture
    const replay = await untilDone(service, taskId);
    expect(replay.at(-1)).toEqual({ kind: "done", state: "COMPLETE" });
  });

  it("first-token overhead stays under 300 ms (best of 3 samples, excludes provider latency)", async () => {
    const { service } = await boot();
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const { taskId } = service.submit({ projectId: "p1", request: `sample ${String(i)}`, mode: "ask" });
      for await (const c of service.stream(taskId, new AbortController().signal)) {
        if (c.kind === "text") {
          samples.push(performance.now() - t0);
          break;
        }
      }
      await untilDone(service, taskId);
    }
    // The fake server answers instantly; what remains is our own overhead (journal, prompt, SDK, hub).
    expect(Math.min(...samples)).toBeLessThan(300);
  });

  it("cancel mid-stream persists the partial answer and ends CANCELLED", async () => {
    const { service, messages } = await boot();
    const { taskId, sessionId } = service.submit({ projectId: "p1", request: "slow please", mode: "ask" });
    const seen: string[] = [];
    for await (const c of service.stream(taskId, new AbortController().signal)) {
      if (c.kind === "text") {
        seen.push(c.delta);
        if (seen.length === 2) service.cancel(taskId);
      }
    }
    const task = service.get(taskId);
    expect(task.state).toBe("CANCELLED");
    const assistant = messages.list(sessionId).find((m) => m.role === "assistant");
    expect(assistant?.partial).toBe(true);
    expect(assistant?.content.length).toBeGreaterThan(0);
    expect(assistant?.content.length).toBeLessThan("one two three four five six seven eight nine ten".length);
  });

  it("provider failures end in NEEDS_USER with the error recorded", async () => {
    const { service } = await boot();
    const { taskId } = service.submit({ projectId: "p1", request: "please fail", mode: "ask" });
    const chunks = await untilDone(service, taskId);
    expect(chunks.some((c) => c.kind === "error")).toBe(true);
    const task = service.get(taskId);
    expect(task.state).toBe("NEEDS_USER");
    expect(task.error).toMatch(/500|upstream|down/i);
  });

  it("rapid submits in one session are serialised: no dropped or duplicated messages", async () => {
    const { service, messages } = await boot();
    const ids = Array.from({ length: 12 }, (_, i) =>
      service.submit({ projectId: "p1", request: `question ${String(i)}`, mode: "ask" }),
    );
    const sessionId = ids[0]!.sessionId;
    expect(new Set(ids.map((x) => x.sessionId)).size).toBe(1);
    await Promise.all(ids.map((x) => untilDone(service, x.taskId)));
    const list = messages.list(sessionId);
    expect(list).toHaveLength(24);
    expect(new Set(list.map((m) => m.id)).size).toBe(24);
    // every task got exactly one answer, and answers arrived in submit order
    const answers = list.filter((m) => m.role === "assistant");
    expect(answers.map((m) => m.taskId)).toEqual(ids.map((x) => x.taskId));
    expect(list.filter((m) => m.role === "user").map((m) => m.taskId)).toEqual(ids.map((x) => x.taskId));
    expect(ids.every((x) => service.get(x.taskId).state === "COMPLETE")).toBe(true);
  });

  it("marks tasks left running by a previous process as INTERRUPTED", async () => {
    const { h, service } = await boot();
    const repo = new TasksRepository(h.db);
    const session = new SessionsRepository(h.db);
    session.insert({ id: "s9", projectId: "p1", title: "t", createdAt: 1, lastActiveAt: 1 });
    repo.insert({
      id: "t9",
      projectId: "p1",
      sessionId: "s9",
      mode: "ask",
      request: "r",
      complexity: "standard",
      state: "EXECUTE",
      cost: { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
      createdAt: 1,
      updatedAt: 1,
    });
    const recovered = service.recoverInterrupted();
    expect(recovered.map((t) => t.state)).toEqual(["INTERRUPTED"]);
    expect(service.get("t9").terminalAt).toBeDefined();
    expect(taskContracts.isTerminalTaskState("INTERRUPTED")).toBe(false);
  });
});

describe("TaskEventHub", () => {
  it("coalesces text bursts and replays for late subscribers", async () => {
    const hub = new TaskEventHub({ batchMs: 5 });
    hub.publish("t", { kind: "state", state: "EXECUTE" });
    for (const w of ["a", "b", "c"]) hub.publish("t", { kind: "text", delta: w });
    hub.publish("t", { kind: "done", state: "COMPLETE" });
    const chunks = await collect(hub.subscribe("t", new AbortController().signal));
    expect(chunks).toEqual([
      { kind: "state", state: "EXECUTE" },
      { kind: "text", delta: "abc" },
      { kind: "done", state: "COMPLETE" },
    ]);
  });

  it("stops when the subscriber aborts", async () => {
    const hub = new TaskEventHub({ batchMs: 0 });
    const ac = new AbortController();
    hub.publish("t", { kind: "state", state: "EXECUTE" });
    const it = hub.subscribe("t", ac.signal)[Symbol.asyncIterator]();
    expect((await it.next()).done).toBe(false);
    setTimeout(() => ac.abort(), 5);
    expect((await it.next()).done).toBe(true);
  });
});
