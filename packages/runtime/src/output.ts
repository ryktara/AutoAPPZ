import type { runtime as contracts } from "@autoappz/contracts";

type OutputLine = contracts.OutputLine;
type Phase = contracts.Phase;

/** Bounded per-project log store (ring buffer) with monotonically increasing seq and live listeners. */
export class OutputRing {
  private readonly lines: OutputLine[] = [];
  private seq = 0;
  private readonly listeners = new Set<(line: OutputLine) => void>();

  constructor(
    private readonly capacity = 5_000,
    private readonly now: () => number = Date.now,
  ) {}

  push(phase: Phase, stream: OutputLine["stream"], text: string): OutputLine {
    const line: OutputLine = { seq: ++this.seq, phase, stream, text, at: this.now() };
    this.lines.push(line);
    if (this.lines.length > this.capacity) this.lines.splice(0, this.lines.length - this.capacity);
    for (const l of this.listeners) l(line);
    return line;
  }

  list(
    options: { phase?: Phase | undefined; afterSeq?: number | undefined; limit?: number | undefined } = {},
  ): OutputLine[] {
    const after = options.afterSeq ?? 0;
    const filtered = this.lines.filter(
      (l) => l.seq > after && (options.phase === undefined || l.phase === options.phase),
    );
    const limit = options.limit ?? filtered.length;
    return filtered.slice(-limit);
  }

  subscribe(listener: (line: OutputLine) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get lastSeq(): number {
    return this.seq;
  }
}

/** Splits arbitrary chunks into complete lines; keeps the trailing partial line for the next chunk. */
export class LineSplitter {
  private rest = "";

  push(chunk: string): string[] {
    const text = this.rest + chunk.replace(/\r\n?/g, "\n");
    const parts = text.split("\n");
    this.rest = parts.pop() ?? "";
    return parts;
  }

  flush(): string[] {
    const r = this.rest;
    this.rest = "";
    return r.length > 0 ? [r] : [];
  }
}

// eslint-disable-next-line no-control-regex -- ANSI escape sequences
const ANSI = /\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}
