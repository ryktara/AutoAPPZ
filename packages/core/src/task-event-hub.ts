import type { tasks } from "@autoappz/contracts";

type Chunk = tasks.TaskStreamChunk;

interface Topic {
  readonly buffer: Chunk[];
  readonly listeners: Set<(chunk: Chunk | null) => void>;
  closed: boolean;
}

/**
 * In-memory fan-out of task stream chunks. Late subscribers replay the buffer, then receive live chunks.
 * Text deltas are coalesced per subscriber within a short window to bound message volume (backpressure).
 */
export class TaskEventHub {
  private readonly topics = new Map<string, Topic>();

  constructor(
    private readonly options: { batchMs?: number | undefined; retainClosedMs?: number | undefined } = {},
  ) {}

  publish(taskId: string, chunk: Chunk): void {
    const topic = this.topic(taskId);
    if (topic.closed) return;
    topic.buffer.push(chunk);
    for (const l of topic.listeners) l(chunk);
    if (chunk.kind === "done") {
      topic.closed = true;
      for (const l of topic.listeners) l(null);
      setTimeout(() => this.topics.delete(taskId), this.options.retainClosedMs ?? 60_000).unref?.();
    }
  }

  has(taskId: string): boolean {
    return this.topics.has(taskId);
  }

  subscribe(taskId: string, signal: AbortSignal): AsyncIterable<Chunk> {
    const topic = this.topic(taskId);
    const batchMs = this.options.batchMs ?? 30;
    return {
      [Symbol.asyncIterator]: () => {
        const queue: Chunk[] = [...topic.buffer];
        let closed = topic.closed;
        let wake: (() => void) | undefined;
        const listener = (c: Chunk | null) => {
          if (c === null) closed = true;
          else queue.push(c);
          wake?.();
        };
        if (!closed) topic.listeners.add(listener);
        const onAbort = () => {
          closed = true;
          wake?.();
        };
        signal.addEventListener("abort", onAbort, { once: true });
        const cleanup = () => {
          topic.listeners.delete(listener);
          signal.removeEventListener("abort", onAbort);
        };
        return {
          async next(): Promise<IteratorResult<Chunk>> {
            for (;;) {
              while (queue.length === 0 && !closed && !signal.aborted) {
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
                wake = undefined;
              }
              if (signal.aborted || (queue.length === 0 && closed)) {
                cleanup();
                return { value: undefined, done: true };
              }
              const first = queue.shift();
              if (first === undefined) continue;
              if (first.kind !== "text" && first.kind !== "reasoning") return { value: first, done: false };
              // Coalesce a burst of text deltas into one chunk.
              if (batchMs > 0) await new Promise((r) => setTimeout(r, batchMs));
              let delta = first.delta;
              while (queue[0]?.kind === first.kind) {
                const same = queue.shift() as { kind: "text" | "reasoning"; delta: string };
                delta += same.delta;
              }
              return { value: { kind: first.kind, delta }, done: false };
            }
          },
          return(): Promise<IteratorResult<Chunk>> {
            cleanup();
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  }

  private topic(taskId: string): Topic {
    let t = this.topics.get(taskId);
    if (!t) {
      t = { buffer: [], listeners: new Set(), closed: false };
      this.topics.set(taskId, t);
    }
    return t;
  }
}
