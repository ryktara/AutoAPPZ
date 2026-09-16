import {
  AppError,
  WireMessageSchema,
  type AnyCommand,
  type AnyEvent,
  type AnyQuery,
  type AnyStream,
  type ChunkOf,
  type CorrelationIds,
  type InputOf,
  type OutputOf,
  type PayloadOf,
} from "@autoappz/contracts";
import { nextId } from "./ids.ts";
import type { Transport } from "./transport.ts";

export interface StreamObserver<C> {
  onChunk(chunk: C): void;
  onEnd(): void;
  onError(error: AppError): void;
}

export interface StreamHandle {
  readonly id: string;
  cancel(): void;
}

export interface CommandBusClientOptions {
  transport: Transport;
  ids: () => CorrelationIds;
  /** Capability token issued by the host for this peer. */
  subscriptionToken: string;
  onInvalidate?: (scopes: readonly string[]) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: AppError) => void;
}

interface ActiveStream {
  observer: StreamObserver<unknown>;
  expectedSeq: number;
}

/**
 * Peer side of the command bus (renderer or any other process).
 * Knows nothing about Electron; only about a Transport.
 */
export class CommandBusClient {
  private readonly transport: Transport;
  private readonly ids: () => CorrelationIds;
  private readonly token: string;
  private readonly pending = new Map<string, Pending>();
  private readonly streams = new Map<string, ActiveStream>();
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly lastEventSeq = new Map<string, number>();
  private readonly detach: () => void;

  constructor(options: CommandBusClientOptions) {
    this.transport = options.transport;
    this.ids = options.ids;
    this.token = options.subscriptionToken;
    this.detach = this.transport.onMessage((raw) => {
      this.onWire(raw);
    });
    if (options.onInvalidate) {
      const cb = options.onInvalidate;
      this.listeners.set("cache.invalidate", new Set([(p) => cb((p as { scopes: string[] }).scopes)]));
      this.transport.send({ type: "subscribe", name: "cache.invalidate", token: this.token });
    }
  }

  dispatch<D extends AnyCommand | AnyQuery>(
    def: D,
    input: InputOf<D>,
    options: { signal?: AbortSignal } = {},
  ): Promise<OutputOf<D>> {
    const id = nextId("req");
    return new Promise<OutputOf<D>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      if (options.signal) {
        const onAbort = () => {
          this.transport.send({ type: "cancel", cancel: { id } });
        };
        if (options.signal.aborted) onAbort();
        else options.signal.addEventListener("abort", onAbort, { once: true });
      }
      this.transport.send({
        type: "request",
        request: { id, name: def.name, ids: this.ids(), issuedAt: Date.now(), input },
      });
    });
  }

  stream<D extends AnyStream>(def: D, input: InputOf<D>, observer: StreamObserver<ChunkOf<D>>): StreamHandle {
    const id = nextId("stm");
    this.streams.set(id, { observer, expectedSeq: 0 });
    this.transport.send({
      type: "request",
      request: { id, name: def.name, ids: this.ids(), issuedAt: Date.now(), input },
    });
    return {
      id,
      cancel: () => {
        this.transport.send({ type: "cancel", cancel: { id } });
      },
    };
  }

  on<D extends AnyEvent>(def: D, listener: (payload: PayloadOf<D>) => void): () => void {
    let set = this.listeners.get(def.name);
    if (!set) {
      set = new Set();
      this.listeners.set(def.name, set);
      this.transport.send({ type: "subscribe", name: def.name, token: this.token });
    }
    const wrapped = (p: unknown) => {
      const parsed = def.payload.safeParse(p);
      if (parsed.success) listener(parsed.data as PayloadOf<D>);
    };
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
      if (set.size === 0) {
        this.listeners.delete(def.name);
        this.transport.send({ type: "unsubscribe", name: def.name, token: this.token });
      }
    };
  }

  close(): void {
    this.detach();
    const err = new AppError("cancelled", "bus.client_closed", "Client closed");
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    for (const s of this.streams.values()) s.observer.onError(err);
    this.streams.clear();
  }

  private onWire(raw: unknown): void {
    const parsed = WireMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const msg = parsed.data;
    switch (msg.type) {
      case "response": {
        const p = this.pending.get(msg.response.id);
        if (!p) return;
        this.pending.delete(msg.response.id);
        if (msg.response.ok) p.resolve(msg.response.value);
        else p.reject(AppError.fromSerialized(msg.response.error));
        return;
      }
      case "stream": {
        const s = this.streams.get(msg.message.streamId);
        if (!s) return;
        if (msg.message.seq !== s.expectedSeq) {
          this.streams.delete(msg.message.streamId);
          s.observer.onError(
            new AppError("internal", "bus.stream_out_of_order", "Stream chunk arrived out of order", {
              details: { expected: s.expectedSeq, got: msg.message.seq },
            }),
          );
          return;
        }
        s.expectedSeq += 1;
        if (msg.message.kind === "chunk") s.observer.onChunk(msg.message.payload);
        else if (msg.message.kind === "end") {
          this.streams.delete(msg.message.streamId);
          s.observer.onEnd();
        } else {
          this.streams.delete(msg.message.streamId);
          s.observer.onError(AppError.fromSerialized(msg.message.error));
        }
        return;
      }
      case "event": {
        const last = this.lastEventSeq.get(msg.event.name) ?? 0;
        if (msg.event.seq <= last) return; // duplicate or stale
        this.lastEventSeq.set(msg.event.name, msg.event.seq);
        const set = this.listeners.get(msg.event.name);
        if (!set) return;
        for (const l of set) l(msg.event.payload);
        return;
      }
      case "request":
      case "cancel":
      case "subscribe":
      case "unsubscribe":
        return;
    }
  }
}
