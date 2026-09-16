import type { CorrelationIds } from "@autoappz/contracts";
import { Redactor } from "./redaction.ts";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";
const LEVEL_ORDER: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };

export interface LogRecord {
  ts: number;
  level: LogLevel;
  scope: string;
  msg: string;
  ids: Partial<CorrelationIds>;
  fields: Record<string, unknown> | undefined;
}

export interface LogSink {
  write(record: LogRecord): void;
}

export interface Logger {
  trace(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(scope: string, ids?: Partial<CorrelationIds>): Logger;
  withIds(ids: Partial<CorrelationIds>): Logger;
}

export interface LoggerRootOptions {
  level?: LogLevel;
  sinks: LogSink[];
  redactor?: Redactor;
  now?: () => number;
}

export function parseLogLevel(value: string | undefined, fallback: LogLevel = "info"): LogLevel {
  if (value && value in LEVEL_ORDER) return value as LogLevel;
  return fallback;
}

export function createLoggerRoot(options: LoggerRootOptions): {
  logger: Logger;
  redactor: Redactor;
  setLevel(level: LogLevel): void;
} {
  const redactor = options.redactor ?? new Redactor();
  const now = options.now ?? Date.now;
  let minLevel = LEVEL_ORDER[options.level ?? "info"];

  const make = (scope: string, ids: Partial<CorrelationIds>): Logger => {
    const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
      if (LEVEL_ORDER[level] < minLevel) return;
      const record: LogRecord = {
        ts: now(),
        level,
        scope,
        msg: redactor.redactString(msg),
        ids,
        fields: fields === undefined ? undefined : redactor.redact(fields),
      };
      for (const sink of options.sinks) {
        try {
          sink.write(record);
        } catch {
          // a failing sink must never take down the app
        }
      }
    };
    return {
      trace: (m, f) => {
        emit("trace", m, f);
      },
      debug: (m, f) => {
        emit("debug", m, f);
      },
      info: (m, f) => {
        emit("info", m, f);
      },
      warn: (m, f) => {
        emit("warn", m, f);
      },
      error: (m, f) => {
        emit("error", m, f);
      },
      child: (childScope, childIds) => make(`${scope}.${childScope}`, { ...ids, ...childIds }),
      withIds: (more) => make(scope, { ...ids, ...more }),
    };
  };

  return {
    logger: make("app", {}),
    redactor,
    setLevel(level) {
      minLevel = LEVEL_ORDER[level];
    },
  };
}

/** JSON-lines sink writing to any `write(string)` target (stdout, file stream). */
export function jsonLineSink(target: { write(chunk: string): unknown }): LogSink {
  return {
    write(record) {
      target.write(`${JSON.stringify(record)}\n`);
    },
  };
}

/** Bounded in-memory sink for diagnostic bundles and tests. */
export class RingBufferSink implements LogSink {
  private readonly buffer: LogRecord[] = [];
  constructor(private readonly capacity = 5_000) {}
  write(record: LogRecord): void {
    this.buffer.push(record);
    if (this.buffer.length > this.capacity) this.buffer.shift();
  }
  snapshot(): readonly LogRecord[] {
    return [...this.buffer];
  }
  clear(): void {
    this.buffer.length = 0;
  }
}
