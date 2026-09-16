import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AppError,
  defineCommand,
  defineEvent,
  defineQuery,
  defineStream,
  type AnyDefinition,
} from "@autoappz/contracts";
import { CommandBusClient, CommandBusHost, createLocalTransportPair, type PeerInfo } from "../src/index.ts";

const add = defineCommand({
  name: "math.add",
  input: z.object({ a: z.number(), b: z.number() }),
  output: z.object({ sum: z.number() }),
  invalidates: ["math"],
});
const slow = defineCommand({
  name: "math.slow",
  input: z.object({ ms: z.number() }),
  output: z.literal("done"),
});
const bad = defineQuery({ name: "math.bad", input: z.void(), output: z.number(), scope: "math" });
const count = defineStream({ name: "math.count", input: z.object({ to: z.number() }), chunk: z.number() });
const tick = defineEvent({ name: "clock.tick", payload: z.object({ n: z.number() }) });
const cacheInvalidate = defineEvent({
  name: "cache.invalidate",
  payload: z.object({ scopes: z.array(z.string()) }),
});

const CONTRACTS: AnyDefinition[] = [add, slow, bad, count, tick, cacheInvalidate];
const ids = () => ({ sessionId: "s1" });

function setup(peer: PeerInfo = { peerId: "win-1", trusted: true }) {
  const host = new CommandBusHost({ contracts: CONTRACTS, defaultTimeoutMs: 200 });
  host.handle(add, ({ a, b }) => ({ sum: a + b }));
  host.handle(slow, async ({ ms }, ctx) => {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      ctx.signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      });
    });
    return "done" as const;
  });
  host.handle(bad, () => "not a number" as unknown as number);
  host.handleStream(count, async function* ({ to }, ctx) {
    for (let i = 0; i < to; i++) {
      if (ctx.signal.aborted) return;
      await new Promise((r) => setTimeout(r, 1));
      yield i;
    }
  });
  const [hostSide, clientSide] = createLocalTransportPair(peer);
  host.attach(peer.peerId, hostSide);
  const token = host.issueSubscriptionToken(peer.peerId);
  const client = new CommandBusClient({ transport: clientSide, ids, subscriptionToken: token });
  return { host, client, token, clientSide };
}

describe("CommandBusHost + CommandBusClient", () => {
  it("dispatches a command through the transport with validated input/output", async () => {
    const { client } = setup();
    await expect(client.dispatch(add, { a: 2, b: 3 })).resolves.toEqual({ sum: 5 });
  });

  it("rejects invalid input with a validation AppError", async () => {
    const { client } = setup();
    const err = await client.dispatch(add, { a: "x" as unknown as number, b: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).kind).toBe("validation");
    expect((err as AppError).code).toBe("bus.invalid_input");
  });

  it("rejects invalid handler output as internal (never leaks bad data)", async () => {
    const { client } = setup();
    const err = await client.dispatch(bad, undefined).catch((e: unknown) => e);
    expect((err as AppError).code).toBe("bus.invalid_output");
  });

  it("supports cancellation from the client", async () => {
    const { client, host } = setup();
    const ac = new AbortController();
    const p = client.dispatch(slow, { ms: 5_000 }, { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 10));
    expect(host.inflightCount).toBe(1);
    ac.abort();
    const err = await p.catch((e: unknown) => e);
    expect((err as AppError).kind).toBe("cancelled");
    expect(host.inflightCount).toBe(0);
  });

  it("times out long commands", async () => {
    const { client } = setup();
    const err = await client.dispatch(slow, { ms: 5_000 }).catch((e: unknown) => e);
    expect((err as AppError).kind).toBe("timeout");
  });

  it("streams ordered chunks then end", async () => {
    const { client } = setup();
    const chunks: number[] = [];
    await new Promise<void>((resolve, reject) => {
      client.stream(count, { to: 4 }, { onChunk: (c) => chunks.push(c), onEnd: resolve, onError: reject });
    });
    expect(chunks).toEqual([0, 1, 2, 3]);
  });

  it("cancels streams", async () => {
    const { client } = setup();
    const chunks: number[] = [];
    const err = await new Promise<AppError>((resolve) => {
      const h = client.stream(
        count,
        { to: 1_000 },
        {
          onChunk: (c) => {
            chunks.push(c);
            if (c === 2) h.cancel();
          },
          onEnd: () => resolve(new AppError("internal", "unexpected", "ended")),
          onError: resolve,
        },
      );
    });
    expect(err.kind).toBe("cancelled");
    expect(chunks.length).toBeLessThan(50);
  });

  it("delivers events only to subscribed peers with a valid token", async () => {
    const { client, host } = setup();
    const seen: number[] = [];
    const off = client.on(tick, (p) => seen.push(p.n));
    await new Promise((r) => setTimeout(r, 5));
    host.publish(tick, { n: 1 });
    host.publish(tick, { n: 2 });
    await new Promise((r) => setTimeout(r, 5));
    off();
    await new Promise((r) => setTimeout(r, 5));
    host.publish(tick, { n: 3 });
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual([1, 2]);
  });

  it("ignores subscriptions with a forged token", async () => {
    const peer: PeerInfo = { peerId: "win-2", trusted: true };
    const host = new CommandBusHost({ contracts: CONTRACTS });
    const [hostSide, clientSide] = createLocalTransportPair(peer);
    host.attach(peer.peerId, hostSide);
    const client = new CommandBusClient({ transport: clientSide, ids, subscriptionToken: "forged" });
    const seen: number[] = [];
    client.on(tick, (p) => seen.push(p.n));
    await new Promise((r) => setTimeout(r, 5));
    host.publish(tick, { n: 1 });
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual([]);
  });

  it("drops every message from untrusted peers", async () => {
    const { client } = setup({ peerId: "evil", trusted: false });
    const ac = new AbortController();
    const p = client.dispatch(add, { a: 1, b: 1 }, { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    // never answered; client closes it out
    client.close();
    const err = await p.catch((e: unknown) => e);
    expect((err as AppError).code).toBe("bus.client_closed");
  });

  it("publishes invalidation scopes after successful commands", async () => {
    const onInvalidate = vi.fn();
    const host = new CommandBusHost({ contracts: CONTRACTS, onInvalidate });
    host.handle(add, ({ a, b }) => ({ sum: a + b }));
    await host.dispatch(add, { a: 1, b: 1 }, ids());
    expect(onInvalidate).toHaveBeenCalledWith(["math"]);
  });

  it("reports contracts without handlers", () => {
    const host = new CommandBusHost({ contracts: CONTRACTS });
    host.handle(add, ({ a, b }) => ({ sum: a + b }));
    expect(host.unhandledContracts()).toEqual(["math.slow", "math.bad", "math.count"]);
  });

  it("refuses duplicate or unknown handlers", () => {
    const host = new CommandBusHost({ contracts: CONTRACTS });
    host.handle(add, ({ a, b }) => ({ sum: a + b }));
    expect(() => host.handle(add, () => ({ sum: 0 }))).toThrow(/already registered/);
    const other = defineCommand({ name: "x.y", input: z.void(), output: z.void() });
    expect(() => host.handle(other, () => undefined)).toThrow(/Unknown contract/);
  });
});
