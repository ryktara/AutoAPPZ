import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class FakeClock {
  private t: number;
  constructor(start = 1_700_000_000_000) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>, prefix = "autoappz-test-"): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export { startFakeModelServer } from "./fake-model-server.ts";
export type {
  FakeModelServer,
  FakeModelServerOptions,
  FakeScenario,
  FakeToolCall,
  FakeTurn,
  RecordedRequest,
} from "./fake-model-server.ts";
