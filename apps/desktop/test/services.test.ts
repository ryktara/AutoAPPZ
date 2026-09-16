import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_CONTRACTS, settings, workspace } from "@autoappz/contracts";
import { CommandBusClient, createLocalTransportPair } from "@autoappz/command-bus";
import { createLoggerRoot, Redactor, RingBufferSink } from "@autoappz/diagnostics";
import { createFakeCipher } from "@autoappz/secrets";
import { withTempDir } from "@autoappz/testing";
import { createServices } from "../src/main/services.ts";

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
    dataDirectory: dir,
    sessionId: "session-1",
    cipher: createFakeCipher(),
    dbPath: path.join(dir, "autoappz.db"),
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
        payloads.push(await client.dispatch(contract, undefined));
      }
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
        dataDirectory: dir,
        sessionId: "s",
        cipher: createFakeCipher(false),
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
