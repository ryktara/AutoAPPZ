import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_CONTRACTS, permissions, project, settings, workspace } from "@autoappz/contracts";
import { CommandBusClient, createLocalTransportPair } from "@autoappz/command-bus";
import { createLoggerRoot, Redactor, RingBufferSink } from "@autoappz/diagnostics";
import { createFakeCipher } from "@autoappz/secrets";
import { withTempDir } from "@autoappz/testing";
import { fileURLToPath } from "node:url";
import { createServices } from "../src/main/services.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(here, "../../../templates");
const fakeHost = { pickDirectory: () => Promise.resolve(null) };

const FIXTURE_SECRET = "sk-fixture-value-that-must-never-leak-0987654321";

async function withServices<T>(fn: (ctx: Awaited<ReturnType<typeof boot>>) => Promise<T>): Promise<T> {
  return withTempDir(async (dir) => {
    const ctx = boot(dir);
    try {
      return await fn(ctx);
    } finally {
      ctx.client.close();
      ctx.services.close();
    }
  });
}

function boot(dir: string) {
  const sink = new RingBufferSink();
  const redactor = new Redactor();
  const { logger } = createLoggerRoot({ sinks: [sink], redactor, level: "trace" });
  const services = createServices({
    logger,
    redactor,
    appVersion: "0.0.0-test",
    platform: "linux",
    dataDirectory: path.join(dir, "data"),
    homeDirectory: path.join(dir, "home"),
    templatesDir: TEMPLATES_DIR,
    sessionId: "session-1",
    cipher: createFakeCipher(),
    host: fakeHost,
    dbPath: path.join(dir, "data", "autoappz.db"),
    consentTimeoutMs: 2_000,
  });
  const peer = { peerId: "window-1", trusted: true };
  const [hostSide, clientSide] = createLocalTransportPair(peer);
  services.bus.attach(peer.peerId, hostSide);
  const client = new CommandBusClient({
    transport: clientSide,
    ids: () => ({ sessionId: "session-1" }),
    subscriptionToken: services.bus.issueSubscriptionToken(peer.peerId),
  });
  return { services, client, sink, redactor };
}

describe("main services", () => {
  it("registers a handler for every command, query and stream", async () => {
    await withServices(({ services }) => {
      expect(services.bus.unhandledContracts()).toEqual([]);
      return Promise.resolve();
    });
  });

  it("persists settings and publishes settings.changed + cache.invalidate", async () => {
    await withServices(async ({ client }) => {
      const changed: string[] = [];
      const invalidated: string[][] = [];
      client.on(settings.settingsChanged, (s) => changed.push(s.theme));
      client.on(workspace.cacheInvalidate, (p) => invalidated.push(p.scopes));
      await new Promise((r) => setTimeout(r, 5));
      const next = await client.dispatch(settings.settingsUpdate, { theme: "dark" });
      expect(next.theme).toBe("dark");
      expect((await client.dispatch(settings.settingsGet, undefined)).theme).toBe("dark");
      await new Promise((r) => setTimeout(r, 5));
      expect(changed).toEqual(["dark"]);
      expect(invalidated).toEqual([["settings"]]);
    });
  });

  it("never returns a secret value in any bus payload or log line (fixture scan)", async () => {
    await withServices(async ({ client, sink, services }) => {
      const ref = await client.dispatch(settings.secretsSet, {
        kind: "api-key",
        label: "Fixture",
        value: FIXTURE_SECRET,
        provider: "openai",
      });
      expect(ref.lastFour).toBe("4321");

      // Exercise every query and command that the renderer could call.
      const payloads: unknown[] = [ref];
      for (const contract of ALL_CONTRACTS) {
        if (contract.kind !== "query") continue;
        if (contract.input.safeParse(undefined).success)
          payloads.push(await client.dispatch(contract, undefined));
      }
      payloads.push(await client.dispatch(project.projectList, { includeArchived: false }));
      const serialized = JSON.stringify(payloads);
      expect(serialized).not.toContain(FIXTURE_SECRET);
      expect(serialized).not.toContain(FIXTURE_SECRET.slice(0, 20));

      // Logs at trace level, including anything the bus logged about the request.
      const logs = JSON.stringify(sink.snapshot());
      expect(logs).not.toContain(FIXTURE_SECRET);

      // Only the main-process API can resolve the value.
      expect(await services.secrets.resolve(ref)).toBe(FIXTURE_SECRET);
      // Resolving registers the value with the redactor; nothing logged afterwards can contain it.
      expect(JSON.stringify(sink.snapshot())).not.toContain(FIXTURE_SECRET);
    });
  });

  it("reports secure storage status and refuses writes when unavailable", async () => {
    await withTempDir(async (dir) => {
      const redactor = new Redactor();
      const { logger } = createLoggerRoot({ sinks: [], redactor });
      const services = createServices({
        logger,
        redactor,
        appVersion: "0",
        platform: "linux",
        dataDirectory: path.join(dir, "data"),
        homeDirectory: path.join(dir, "home"),
        templatesDir: TEMPLATES_DIR,
        sessionId: "s",
        cipher: createFakeCipher(false),
        host: fakeHost,
        dbPath: ":memory:",
      });
      const status = await services.bus.dispatch(settings.secretsStorageStatus, undefined, {
        sessionId: "s",
      });
      expect(status).toEqual({ available: false, backend: "none" });
      await expect(
        services.bus.dispatch(
          settings.secretsSet,
          { kind: "api-key", label: "x", value: "y" },
          { sessionId: "s" },
        ),
      ).rejects.toMatchObject({ code: "secrets.no_secure_storage" });
      services.close();
    });
  });
});

describe("project handlers", () => {
  it("creates a project through the bus and publishes project.changed", async () => {
    await withServices(async ({ client }) => {
      const changes: string[] = [];
      client.on(project.projectChanged, (c) => changes.push(`${c.kind}:${c.id}`));
      await new Promise((r) => setTimeout(r, 5));
      const templates = await client.dispatch(project.projectTemplates, undefined);
      expect(templates.map((t) => t.id)).toContain("react-vite");
      const created = await client.dispatch(project.projectCreate, {
        name: "Bus App",
        templateId: "react-vite",
      });
      expect(created.path.endsWith("bus-app")).toBe(true);
      const list = await client.dispatch(project.projectList, { includeArchived: false });
      expect(list.map((p) => p.id)).toEqual([created.id]);
      await new Promise((r) => setTimeout(r, 5));
      expect(changes).toEqual([`created:${created.id}`]);
      const picked = await client.dispatch(project.dialogPickDirectory, {});
      expect(picked).toEqual({ path: null });
    });
  });
});

describe("tool runtime + consent over the bus", () => {
  it("parks a write, surfaces the consent request as an event, applies the choice and audits", async () => {
    await withServices(async ({ client, services }) => {
      const created = await client.dispatch(project.projectCreate, {
        name: "Perm App",
        templateId: "react-vite",
      });
      // a task row is required for the audit FK; tasks come from M4's runner, so insert one directly
      const { SessionsRepository, TasksRepository } = await import("@autoappz/storage");
      new SessionsRepository(services.db.db).insert({
        id: "s1",
        projectId: created.id,
        title: "t",
        createdAt: 1,
        lastActiveAt: 1,
      });
      new TasksRepository(services.db.db).insert({
        id: "t1",
        projectId: created.id,
        sessionId: "s1",
        mode: "ask",
        request: "r",
        complexity: "standard",
        state: "EXECUTE",
        cost: { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        createdAt: 1,
        updatedAt: 1,
      });

      const requests: string[] = [];
      client.on(permissions.consentRequested, (r) => requests.push(r.id));
      await new Promise((r) => setTimeout(r, 5));

      const { ReadLedger } = await import("@autoappz/tools");
      const ledger = new ReadLedger();
      const run = (toolId: string, input: unknown) =>
        services.tools.execute({
          toolId,
          input,
          projectId: created.id,
          projectRoot: created.path,
          taskId: "t1",
          signal: new AbortController().signal,
          ledger,
        });

      const read = await run("fs.read", { path: "src/App.tsx" });
      expect(read.ok).toBe(true);

      const write = run("fs.patch", {
        path: "src/App.tsx",
        edits: [{ find: "Your app is running", replace: "Hello from AutoAPPZ" }],
      });
      await new Promise((r) => setTimeout(r, 10));
      expect(requests).toHaveLength(1);
      const pending = await client.dispatch(permissions.permissionsPending, { projectId: created.id });
      expect(pending[0]).toMatchObject({
        id: requests[0],
        toolId: "fs.patch",
        scope: "src/App.tsx",
        risk: "medium",
      });
      await client.dispatch(permissions.permissionsRespond, {
        requestId: requests[0]!,
        choice: "allow_project",
      });
      expect((await write).ok).toBe(true);

      const rules = await client.dispatch(permissions.permissionsPolicies, { projectId: created.id });
      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({ capability: "fs.write", scopePattern: "src/**", lifetime: "project" });

      const audit = await client.dispatch(permissions.toolAudit, { taskId: "t1" });
      expect(audit.map((a) => [a.toolId, a.decision, a.decisionSource, a.ok])).toEqual([
        ["fs.read", "allow", "default", true],
        ["fs.patch", "allow", "user", true],
      ]);
      await client.dispatch(permissions.permissionsRevoke, { id: rules[0]!.id });
      expect(await client.dispatch(permissions.permissionsPolicies, { projectId: created.id })).toEqual([]);
    });
  });
});
