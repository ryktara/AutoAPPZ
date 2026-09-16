import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProviderRegistry } from "@autoappz/ai-providers";
import { providers as providerContracts, type permissions as permissionContracts } from "@autoappz/contracts";
import { Redactor } from "@autoappz/diagnostics";
import { PermissionEngine } from "@autoappz/permissions";
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
import { collect, startFakeModelServer, withTempDir, type FakeModelServer } from "@autoappz/testing";
import { FS_TOOLS, ToolRuntime, createSearchTool } from "@autoappz/tools";
import { ChangeTracker, TaskEventHub, TaskService, type TaskVcs } from "../src/index.ts";

const PLAN = JSON.stringify({
  summary: "Change the greeting in App.tsx",
  steps: [{ id: "s1", title: "Edit the heading", detail: "Replace the text", files: ["src/App.tsx"] }],
  acceptanceCriteria: ["Heading reads Hi there"],
  risks: [],
});
const REVISED_PLAN = JSON.stringify({
  summary: "Revised: shorter greeting",
  steps: [{ id: "s1", title: "Edit heading" }],
});

let server: FakeModelServer;
beforeAll(async () => {
  server = await startFakeModelServer({
    scenarios: [
      { match: /^Plan this request:[\s\S]*asked for changes/, turns: [{ text: REVISED_PLAN }] },
      { match: /^Plan this request/, turns: [{ text: PLAN }] },
      { match: /^Review the changes/, turns: [{ text: '{"verdict":"pass","notes":[]}' }] },
      {
        match: "Please change the greeting",
        turns: [
          { toolCalls: [{ name: "fs.read", input: { path: "src/App.tsx" } }] },
          {
            toolCalls: [
              {
                name: "fs.patch",
                input: { path: "src/App.tsx", edits: [{ find: "Hello", replace: "Hi there" }] },
              },
            ],
          },
          { text: "Done: the heading now reads Hi there." },
        ],
      },
      {
        match: "tiny tweak",
        turns: [
          { toolCalls: [{ name: "fs.write", input: { path: "NOTES.md", content: "tweak\n" } }] },
          { text: "Added NOTES.md." },
        ],
      },
      {
        match: "loop forever",
        turns: [{ toolCalls: [{ name: "fs.read", input: { path: "src/App.tsx" } }] }],
      },
    ],
  });
});
afterAll(async () => {
  await server.close();
});

async function boot(
  root: string,
  approval: "none" | "trivial" | "standard",
  opts: { allowWrites?: boolean; vcs?: TaskVcs } = {},
) {
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "App.tsx"), "export const App = () => <h1>Hello</h1>;\n");
  const h = openDatabase({ path: ":memory:" });
  const project = {
    id: "p1",
    name: "Shop",
    path: root,
    origin: "created" as const,
    runtimeProfile: "host" as const,
    createdAt: 1,
    lastOpenedAt: 1,
  };
  new ProjectsRepository(h.db).insert(project);
  let settings = providerContracts.ProviderSettingsSchema.parse({
    providers: [{ providerId: "openai-compatible", enabled: true, baseUrl: server.baseUrl }],
  });
  const usageRepo = new UsageRecordsRepository(h.db);
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
  const rows: permissionContracts.Policy[] = opts.allowWrites
    ? [
        {
          id: "allow",
          capability: "fs.write" as const,
          scopePattern: "**",
          decision: "allow" as const,
          lifetime: "project" as const,
          createdAt: 0,
        },
      ]
    : [];
  const permissions = new PermissionEngine({
    store: {
      list: () => rows,
      insert: (p) => {
        rows.push(p);
      },
      delete: () => false,
    },
    consentTimeoutMs: 2_000,
  });
  const tools = new ToolRuntime({
    tools: [...FS_TOOLS, createSearchTool()],
    permissions,
    audit: { record: () => undefined },
    redactor: new Redactor(),
  });
  let n = 0;
  const changesRepo = new TaskChangesRepository(h.db);
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
      project: () => project,
      memory: () => [],
      blueprint: () => null,
      approvalThreshold: () => approval,
    },
    vcs: opts.vcs,
    newId: (p) => `${p}_${String(++n).padStart(3, "0")}`,
    hub: new TaskEventHub({ batchMs: 0 }),
  });
  return {
    h,
    service,
    permissions,
    events: new TaskEventsRepository(h.db),
    messages: new MessagesRepository(h.db),
  };
}

const untilDone = (service: TaskService, taskId: string) =>
  collect(service.stream(taskId, new AbortController().signal));
const waitForState = async (service: TaskService, taskId: string, state: string) => {
  for (let i = 0; i < 200; i++) {
    if (service.get(taskId).state === state) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`task never reached ${state} (now ${service.get(taskId).state})`);
};

describe("build tasks", () => {
  it("plans, waits for approval, builds with tools, records changes and completes", async () => {
    await withTempDir(async (root) => {
      const { service, events, messages } = await boot(root, "none", { allowWrites: true });
      const requestText =
        "Please change the greeting in the app heading to something friendlier for visitors who open the page for the first time";
      const { taskId } = service.submit({ projectId: "p1", request: requestText, mode: "build" });
      await waitForState(service, taskId, "AWAIT_APPROVAL");
      const task = service.get(taskId);
      expect(task.complexity).toBe("standard");
      expect(task.plan?.summary).toBe("Change the greeting in App.tsx");
      expect(readFileSync(path.join(root, "src", "App.tsx"), "utf8")).toContain("Hello"); // nothing changed yet

      service.approve(taskId);
      const chunks = await untilDone(service, taskId);
      expect(service.get(taskId).state).toBe("COMPLETE");
      expect(readFileSync(path.join(root, "src", "App.tsx"), "utf8")).toContain("Hi there");
      expect(
        chunks.filter((c) => c.kind === "tool-call").map((c) => (c as { toolId: string }).toolId),
      ).toEqual(["fs.read", "fs.patch"]);
      expect(chunks.filter((c) => c.kind === "tool-result").every((c) => (c as { ok: boolean }).ok)).toBe(
        true,
      );
      const changes = service.changes(taskId);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ path: "src/App.tsx", kind: "modified" });
      expect(changes[0]?.before).toContain("Hello");
      expect(changes[0]?.after).toContain("Hi there");
      expect(events.list(taskId).map((e) => e.toState)).toEqual([
        "UNDERSTAND",
        "PLAN",
        "AWAIT_APPROVAL",
        "EXECUTE",
        "VALIDATE",
        "REVIEW",
        "CHECKPOINT",
        "COMPLETE",
      ]);
      const assistant = messages.list(task.sessionId).filter((m) => m.role === "assistant");
      expect(assistant.at(-1)?.content).toContain("Hi there");
      expect(service.get(taskId).cost.calls).toBe(4); // planner + 3 builder rounds
    });
  });

  it("takes a checkpoint before the first edit and commits the touched paths with the summary", async () => {
    await withTempDir(async (root) => {
      const calls: string[] = [];
      let contentAtCheckpoint = "";
      const vcs: TaskVcs = {
        checkpoint: (task) => {
          calls.push(`checkpoint:${task.id}`);
          contentAtCheckpoint = readFileSync(path.join(root, "src", "App.tsx"), "utf8");
          return Promise.resolve({ ok: true, skippedLargeFiles: [] });
        },
        commit: (task, message, paths) => {
          calls.push(`commit:${task.id}:${message}:${paths.join(",")}`);
          return Promise.resolve({ sha: "abc123def456" });
        },
      };
      const { service } = await boot(root, "standard", { allowWrites: true, vcs });
      const { taskId } = service.submit({
        projectId: "p1",
        request:
          "Please change the greeting in the app heading to something friendlier for first-time visitors",
        mode: "build",
      });
      const chunks = await untilDone(service, taskId);
      expect(service.get(taskId).state).toBe("COMPLETE");
      expect(contentAtCheckpoint).toContain("Hello"); // snapshot happened before the patch
      expect(calls[0]).toBe(`checkpoint:${taskId}`);
      expect(calls[1]).toMatch(new RegExp(`^commit:${taskId}:.+:src/App[.]tsx$`));
      expect(chunks.some((c) => c.kind === "note" && c.text.includes("abc123def4"))).toBe(true);
    });
  });

  it("a refused checkpoint fails the task before any edit", async () => {
    await withTempDir(async (root) => {
      const vcs: TaskVcs = {
        checkpoint: () => Promise.reject(new Error("A merge is in progress")),
        commit: () => Promise.resolve({ sha: undefined }),
      };
      const { service } = await boot(root, "standard", { allowWrites: true, vcs });
      const { taskId } = service.submit({
        projectId: "p1",
        request:
          "Please change the greeting in the app heading to something friendlier for first-time visitors",
        mode: "build",
      });
      await untilDone(service, taskId);
      // Pre-edit failures are retryable, so they park in NEEDS_USER like any other tool/provider failure.
      expect(service.get(taskId).state).toBe("NEEDS_USER");
      expect(service.get(taskId).error).toContain("merge is in progress");
      expect(readFileSync(path.join(root, "src", "App.tsx"), "utf8")).toContain("Hello");
    });
  });

  it("auto-approves below the policy threshold and never shows AWAIT_APPROVAL", async () => {
    await withTempDir(async (root) => {
      const { service, events } = await boot(root, "standard", { allowWrites: true });
      const { taskId } = service.submit({
        projectId: "p1",
        request:
          "Please change the greeting in the app heading to something friendlier for visitors who open the page for the first time",
        mode: "build",
      });
      await untilDone(service, taskId);
      expect(service.get(taskId).state).toBe("COMPLETE");
      expect(events.list(taskId).map((e) => e.event)).toContain("plan_auto_approved");
      expect(events.list(taskId).map((e) => e.toState)).not.toContain("AWAIT_APPROVAL");
    });
  });

  it("trivial tasks run as a single builder sequence: no planner or reviewer calls", async () => {
    await withTempDir(async (root) => {
      const before = server.requests.length;
      const { service } = await boot(root, "none", { allowWrites: true });
      const { taskId } = service.submit({ projectId: "p1", request: "tiny tweak", mode: "build" });
      await untilDone(service, taskId);
      expect(service.get(taskId).complexity).toBe("trivial");
      expect(service.get(taskId).state).toBe("COMPLETE");
      expect(readFileSync(path.join(root, "NOTES.md"), "utf8")).toBe("tweak\n");
      const calls = server.requests.slice(before).filter((r) => r.path.endsWith("/chat/completions"));
      expect(calls).toHaveLength(2); // one tool round + the closing summary
      const prompts = JSON.stringify(calls.map((r) => r.body));
      expect(prompts).not.toContain("Plan this request");
      expect(prompts).not.toContain("Review the changes");
    });
  });

  it("revise re-plans with feedback; reject cancels without touching files", async () => {
    await withTempDir(async (root) => {
      const { service } = await boot(root, "none", { allowWrites: true });
      const { taskId } = service.submit({
        projectId: "p1",
        request:
          "Please change the greeting in the app heading to something friendlier for visitors who open the page for the first time",
        mode: "build",
      });
      await waitForState(service, taskId, "AWAIT_APPROVAL");
      service.revise(taskId, "make it shorter");
      for (let i = 0; i < 200 && service.get(taskId).plan?.revisionOf !== 1; i++)
        await new Promise((r) => setTimeout(r, 10));
      await waitForState(service, taskId, "AWAIT_APPROVAL");
      expect(service.get(taskId).plan?.summary).toBe("Revised: shorter greeting");
      expect(service.get(taskId).plan?.revisionOf).toBe(1);
      service.reject(taskId);
      await untilDone(service, taskId);
      expect(service.get(taskId).state).toBe("CANCELLED");
      expect(readFileSync(path.join(root, "src", "App.tsx"), "utf8")).toContain("Hello");
      expect(() => {
        service.approve(taskId);
      }).toThrow(/not waiting for approval/);
    });
  });

  it("a write without permission is denied, explained to the model, and the task still completes", async () => {
    await withTempDir(async (root) => {
      const { service, permissions } = await boot(root, "standard");
      const { taskId } = service.submit({
        projectId: "p1",
        request:
          "Please change the greeting in the app heading to something friendlier for visitors who open the page for the first time",
        mode: "build",
      });
      let denied = false;
      for await (const c of service.stream(taskId, new AbortController().signal)) {
        if (c.kind === "tool-call" && c.toolId === "fs.patch") {
          await new Promise((r) => setTimeout(r, 20));
          const req = permissions.pending("p1")[0];
          if (req) {
            permissions.respond(req.id, "deny");
            denied = true;
          }
        }
      }
      expect(denied).toBe(true);
      expect(readFileSync(path.join(root, "src", "App.tsx"), "utf8")).toContain("Hello");
      expect(service.get(taskId).state).toBe("COMPLETE");
      expect(service.changes(taskId)).toEqual([]);
    });
  });

  it("stops at the step budget instead of looping forever", async () => {
    await withTempDir(async (root) => {
      const { service } = await boot(root, "none", { allowWrites: true });
      const { taskId } = service.submit({ projectId: "p1", request: "loop forever", mode: "build" });
      await untilDone(service, taskId);
      const task = service.get(taskId);
      expect(task.state).toBe("NEEDS_USER");
      expect(task.error).toMatch(/budget/i);
      expect(task.cost.calls).toBeLessThanOrEqual(13);
    });
  });

  it("resumes an interrupted build into validation without re-executing edits", async () => {
    await withTempDir(async (root) => {
      const { service, h } = await boot(root, "none");
      const sessions = new SessionsRepository(h.db);
      sessions.insert({ id: "s9", projectId: "p1", title: "t", createdAt: 1, lastActiveAt: 1 });
      new TasksRepository(h.db).insert({
        id: "t9",
        projectId: "p1",
        sessionId: "s9",
        mode: "build",
        request: "r",
        complexity: "standard",
        state: "EXECUTE",
        cost: { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        createdAt: 1,
        updatedAt: 1,
      });
      service.recoverInterrupted();
      expect(service.get("t9").state).toBe("INTERRUPTED");
      service.resume("t9");
      const chunks = await untilDone(service, "t9");
      expect(service.get("t9").state).toBe("COMPLETE");
      expect(chunks.some((c) => c.kind === "note" && c.text.includes("no edits are re-executed"))).toBe(true);
      expect(
        server.requests.filter((r) => JSON.stringify(r.body ?? "").includes('"request":"r"')),
      ).toHaveLength(0);
    });
  });
});
