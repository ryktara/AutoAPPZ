import {
  AppError,
  WireMessageSchema,
  type AnyCommand,
  type AnyDefinition,
  type AnyEvent,
  type AnyQuery,
  type AnyStream,
  type ChunkOf,
  type CorrelationIds,
  type InputOf,
  type OutputOf,
  type PayloadOf,
  type RequestEnvelope,
  type WireMessage,
} from "@autoappz/contracts";
import { nextId, randomToken } from "./ids.ts";
import type { PeerInfo, Transport } from "./transport.ts";

export interface HandlerContext {
  readonly signal: AbortSignal;
  readonly ids: CorrelationIds;
  readonly requestId: string;
  readonly peer: PeerInfo;
}

export type CommandHandler<D extends AnyCommand | AnyQuery> = (
  input: InputOf<D>,
  ctx: HandlerContext,
) => Promise<OutputOf<D>> | OutputOf<D>;

export type StreamHandler<D extends AnyStream> = (
  input: InputOf<D>,
  ctx: HandlerContext,
) => AsyncIterable<ChunkOf<D>>;

export interface BusHostLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface CommandBusHostOptions {
  /** Every contract that may be dispatched; unknown names are rejected before validation. */
  contracts: readonly AnyDefinition[];
  logger?: BusHostLogger;
  /** Default timeout for commands/queries. Streams are not timed out. */
  defaultTimeoutMs?: number;
  /** Called after a command succeeds with the scopes it invalidates. */
  onInvalidate?: (scopes: readonly string[]) => void;
}

interface Inflight {
  controller: AbortController;
  peer: PeerInfo;
}

const noop = (): void => undefined;
const noopLogger: BusHostLogger = { debug: noop, warn: noop, error: noop };

/**
 * Main-process side of the command bus.
 * - exactly one handler per command/query/stream contract
 * - validates every input and output against the contract schema
 * - per-request AbortSignal, cancellable from the peer
 * - streams with monotonically increasing seq numbers
 * - events delivered only to peers holding a capability token for that event name
 */
export class CommandBusHost {
  private readonly contracts = new Map<string, AnyDefinition>();
  private readonly handlers = new Map<string, CommandHandler<AnyCommand | AnyQuery>>();
  private readonly streamHandlers = new Map<string, StreamHandler<AnyStream>>();
  private readonly inflight = new Map<string, Inflight>();
  private readonly transports = new Map<string, Transport>();
  private readonly subscriptions = new Map<string, Map<string, Set<string>>>(); // eventName -> peerId -> tokens
  private readonly issuedTokens = new Map<string, string>(); // token -> peerId
  private readonly eventSeq = new Map<string, number>();
  private readonly logger: BusHostLogger;
  private readonly defaultTimeoutMs: number;
  private readonly onInvalidate: ((scopes: readonly string[]) => void) | undefined;

  constructor(options: CommandBusHostOptions) {
    for (const c of options.contracts) this.contracts.set(c.name, c);
    this.logger = options.logger ?? noopLogger;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000;
    this.onInvalidate = options.onInvalidate;
  }

  handle<D extends AnyCommand | AnyQuery>(def: D, handler: CommandHandler<D>): void {
    this.assertKnown(def, ["command", "query"]);
    if (this.handlers.has(def.name)) throw new Error(`Handler already registered for ${def.name}`);
    this.handlers.set(def.name, handler);
  }

  handleStream<D extends AnyStream>(def: D, handler: StreamHandler<D>): void {
    this.assertKnown(def, ["stream"]);
    if (this.streamHandlers.has(def.name))
      throw new Error(`Stream handler already registered for ${def.name}`);
    this.streamHandlers.set(def.name, handler as StreamHandler<AnyStream>);
  }

  /** Names of command/query/stream contracts without a handler — used by tests to enforce completeness. */
  unhandledContracts(): string[] {
    const out: string[] = [];
    for (const c of this.contracts.values()) {
      if ((c.kind === "command" || c.kind === "query") && !this.handlers.has(c.name)) out.push(c.name);
      if (c.kind === "stream" && !this.streamHandlers.has(c.name)) out.push(c.name);
    }
    return out;
  }

  /** Issue a capability token allowing `peerId` to subscribe to events. The host passes it to the peer out of band. */
  issueSubscriptionToken(peerId: string): string {
    const token = randomToken();
    this.issuedTokens.set(token, peerId);
    return token;
  }

  revokePeer(peerId: string): void {
    for (const [token, p] of this.issuedTokens) if (p === peerId) this.issuedTokens.delete(token);
    for (const perPeer of this.subscriptions.values()) perPeer.delete(peerId);
    for (const [id, f] of this.inflight) {
      if (f.peer.peerId === peerId) {
        f.controller.abort();
        this.inflight.delete(id);
      }
    }
    const t = this.transports.get(peerId);
    if (t) {
      t.close();
      this.transports.delete(peerId);
    }
  }

  attach(peerId: string, transport: Transport): () => void {
    this.transports.set(peerId, transport);
    const off = transport.onMessage((raw, peer) => {
      this.onWire(raw, peer, transport);
    });
    return () => {
      off();
      this.revokePeer(peerId);
    };
  }

  /** Publish an event to every subscribed peer. Payload is validated first. */
  publish<D extends AnyEvent>(def: D, payload: PayloadOf<D>): void {
    this.assertKnown(def, ["event"]);
    const parsed = def.payload.safeParse(payload);
    if (!parsed.success) {
      this.logger.error("event payload failed validation", { name: def.name, issues: parsed.error.issues });
      throw new AppError("validation", "event.invalid_payload", `Event ${def.name} payload is invalid`, {
        details: { issues: parsed.error.issues },
      });
    }
    const seq = (this.eventSeq.get(def.name) ?? 0) + 1;
    this.eventSeq.set(def.name, seq);
    const perPeer = this.subscriptions.get(def.name);
    if (!perPeer) return;
    for (const peerId of perPeer.keys()) {
      const t = this.transports.get(peerId);
      t?.send({ type: "event", event: { name: def.name, seq, payload: parsed.data } });
    }
  }

  /** In-process dispatch (used by host-side services and tests). Validates like a wire request would. */
  async dispatch<D extends AnyCommand | AnyQuery>(
    def: D,
    input: InputOf<D>,
    ids: CorrelationIds,
    options: { peer?: PeerInfo; signal?: AbortSignal } = {},
  ): Promise<OutputOf<D>> {
    const peer = options.peer ?? { peerId: "host", trusted: true };
    const requestId = nextId("req");
    const result = await this.execute(
      { id: requestId, name: def.name, ids, issuedAt: Date.now(), input },
      peer,
      options.signal,
    );
    if (!result.ok) throw AppError.fromSerialized(result.error);
    return result.value as OutputOf<D>;
  }

  cancel(requestId: string): boolean {
    const f = this.inflight.get(requestId);
    if (!f) return false;
    f.controller.abort();
    return true;
  }

  get inflightCount(): number {
    return this.inflight.size;
  }

  // ---------------------------------------------------------------- internals

  private assertKnown(def: AnyDefinition, kinds: readonly AnyDefinition["kind"][]): void {
    const known = this.contracts.get(def.name);
    if (!known) throw new Error(`Unknown contract ${def.name}; add it to the registry first.`);
    if (known !== def) throw new Error(`Contract ${def.name} object differs from the registered instance.`);
    if (!kinds.includes(def.kind))
      throw new Error(`Contract ${def.name} is a ${def.kind}, expected ${kinds.join("|")}.`);
  }

  private onWire(raw: unknown, peer: PeerInfo, transport: Transport): void {
    if (!peer.trusted) {
      this.logger.warn("dropping message from untrusted peer", { peerId: peer.peerId });
      return;
    }
    const parsed = WireMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn("dropping malformed wire message", { peerId: peer.peerId });
      return;
    }
    const msg = parsed.data;
    switch (msg.type) {
      case "request": {
        const def = this.contracts.get(msg.request.name);
        if (def?.kind === "stream") {
          void this.runStream(msg.request, peer, transport);
        } else {
          void this.execute(msg.request, peer).then((response) => {
            transport.send({ type: "response", response });
          });
        }
        return;
      }
      case "cancel":
        this.cancel(msg.cancel.id);
        return;
      case "subscribe":
        this.subscribe(msg.name, msg.token, peer);
        return;
      case "unsubscribe":
        this.unsubscribe(msg.name, msg.token, peer);
        return;
      case "response":
      case "stream":
      case "event":
        this.logger.warn("unexpected host-bound message", { type: msg.type, peerId: peer.peerId });
        return;
    }
  }

  private subscribe(name: string, token: string, peer: PeerInfo): void {
    const owner = this.issuedTokens.get(token);
    if (owner !== peer.peerId) {
      this.logger.warn("subscription rejected: invalid token", { name, peerId: peer.peerId });
      return;
    }
    const def = this.contracts.get(name);
    if (def?.kind !== "event") {
      this.logger.warn("subscription rejected: unknown event", { name, peerId: peer.peerId });
      return;
    }
    let perPeer = this.subscriptions.get(name);
    if (!perPeer) {
      perPeer = new Map();
      this.subscriptions.set(name, perPeer);
    }
    let tokens = perPeer.get(peer.peerId);
    if (!tokens) {
      tokens = new Set();
      perPeer.set(peer.peerId, tokens);
    }
    tokens.add(token);
  }

  private unsubscribe(name: string, token: string, peer: PeerInfo): void {
    const perPeer = this.subscriptions.get(name);
    const tokens = perPeer?.get(peer.peerId);
    if (!tokens) return;
    tokens.delete(token);
    if (tokens.size === 0) perPeer?.delete(peer.peerId);
  }

  private async execute(
    request: RequestEnvelope,
    peer: PeerInfo,
    externalSignal?: AbortSignal,
  ): Promise<
    | { id: string; ok: true; value: unknown }
    | { id: string; ok: false; error: ReturnType<AppError["toJSON"]> }
  > {
    const correlationId = request.id;
    const fail = (e: AppError) => ({ id: request.id, ok: false as const, error: e.toJSON() });

    const def = this.contracts.get(request.name);
    if (!def || (def.kind !== "command" && def.kind !== "query")) {
      return fail(
        new AppError("not_found", "bus.unknown_contract", `Unknown command "${request.name}"`, {
          correlationId,
        }),
      );
    }
    const handler = this.handlers.get(def.name);
    if (!handler) {
      return fail(
        new AppError("internal", "bus.no_handler", `No handler for "${request.name}"`, { correlationId }),
      );
    }
    const input = def.input.safeParse(request.input);
    if (!input.success) {
      return fail(
        new AppError("validation", "bus.invalid_input", `Invalid input for "${request.name}"`, {
          correlationId,
          details: { issues: input.error.issues },
        }),
      );
    }

    const controller = new AbortController();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    this.inflight.set(request.id, { controller, peer });
    const timer = setTimeout(
      () => controller.abort(new AppError("timeout", "bus.timeout", `"${request.name}" timed out`)),
      this.defaultTimeoutMs,
    );

    try {
      const value = await Promise.race([
        Promise.resolve(
          handler(input.data, { signal: controller.signal, ids: request.ids, requestId: request.id, peer }),
        ),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            "abort",
            () =>
              reject(
                controller.signal.reason instanceof AppError
                  ? controller.signal.reason
                  : new AppError("cancelled", "bus.cancelled", `"${request.name}" was cancelled`, {
                      correlationId,
                    }),
              ),
            { once: true },
          );
        }),
      ]);
      const output = def.output.safeParse(value);
      if (!output.success) {
        this.logger.error("handler output failed validation", {
          name: def.name,
          issues: output.error.issues,
        });
        return fail(
          new AppError(
            "internal",
            "bus.invalid_output",
            `Handler for "${request.name}" returned invalid output`,
            {
              correlationId,
              details: { issues: output.error.issues },
            },
          ),
        );
      }
      if (def.kind === "command" && def.invalidates.length > 0) this.onInvalidate?.(def.invalidates);
      return { id: request.id, ok: true, value: output.data };
    } catch (error) {
      const appError = AppError.from(error, { correlationId });
      if (appError.kind === "internal")
        this.logger.error("handler threw", {
          name: def.name,
          code: appError.code,
          message: appError.message,
        });
      return fail(appError);
    } finally {
      clearTimeout(timer);
      this.inflight.delete(request.id);
    }
  }

  private async runStream(request: RequestEnvelope, peer: PeerInfo, transport: Transport): Promise<void> {
    const streamId = request.id;
    let seq = 0;
    const send = (m: WireMessage) => {
      transport.send(m);
    };
    const def = this.contracts.get(request.name);
    if (def?.kind !== "stream") return;
    const handler = this.streamHandlers.get(def.name);
    if (!handler) {
      send({
        type: "stream",
        message: {
          streamId,
          seq,
          kind: "error",
          error: new AppError("internal", "bus.no_handler", `No handler for "${request.name}"`).toJSON(),
        },
      });
      return;
    }
    const input = def.input.safeParse(request.input);
    if (!input.success) {
      send({
        type: "stream",
        message: {
          streamId,
          seq,
          kind: "error",
          error: new AppError("validation", "bus.invalid_input", `Invalid input for "${request.name}"`, {
            details: { issues: input.error.issues },
          }).toJSON(),
        },
      });
      return;
    }
    const controller = new AbortController();
    this.inflight.set(streamId, { controller, peer });
    try {
      for await (const chunk of handler(input.data, {
        signal: controller.signal,
        ids: request.ids,
        requestId: streamId,
        peer,
      })) {
        if (controller.signal.aborted) break;
        const parsed = def.chunk.safeParse(chunk);
        if (!parsed.success) {
          throw new AppError(
            "internal",
            "bus.invalid_chunk",
            `Stream "${request.name}" produced an invalid chunk`,
            {
              details: { issues: parsed.error.issues },
            },
          );
        }
        send({ type: "stream", message: { streamId, seq: seq++, kind: "chunk", payload: parsed.data } });
      }
      if (controller.signal.aborted) {
        send({
          type: "stream",
          message: {
            streamId,
            seq: seq++,
            kind: "error",
            error: new AppError("cancelled", "bus.cancelled", "Stream cancelled", {
              correlationId: streamId,
            }).toJSON(),
          },
        });
      } else {
        send({ type: "stream", message: { streamId, seq: seq++, kind: "end" } });
      }
    } catch (error) {
      send({
        type: "stream",
        message: {
          streamId,
          seq: seq++,
          kind: "error",
          error: AppError.from(error, { correlationId: streamId }).toJSON(),
        },
      });
    } finally {
      this.inflight.delete(streamId);
    }
  }
}
