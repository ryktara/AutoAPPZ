import type { AnyQuery, AppError, InputOf, OutputOf } from "@autoappz/contracts";

export type QueryStatus = "loading" | "success" | "error";

export interface QueryEntry<T> {
  readonly status: QueryStatus;
  readonly data: T | undefined;
  readonly error: AppError | undefined;
  /** Increments on every state change; lets React subscribe with useSyncExternalStore. */
  readonly version: number;
}

export interface QueryDispatcher {
  dispatch<D extends AnyQuery>(def: D, input: InputOf<D>): Promise<OutputOf<D>>;
}

interface Record_ {
  entry: QueryEntry<unknown>;
  scope: string;
  def: AnyQuery;
  input: unknown;
  inflight: Promise<void> | undefined;
  listeners: Set<() => void>;
}

const LOADING: QueryEntry<never> = { status: "loading", data: undefined, error: undefined, version: 0 };

/**
 * Minimal query cache for the renderer: one record per (query, input), invalidated by scope when
 * the host publishes `cache.invalidate`. Framework-agnostic and unit-tested without React.
 */
export class QueryCache {
  private readonly records = new Map<string, Record_>();

  constructor(private readonly dispatcher: QueryDispatcher) {}

  static key(def: AnyQuery, input: unknown): string {
    return `${def.name}:${JSON.stringify(input ?? null)}`;
  }

  /** Returns the current entry, starting a fetch when nothing is cached yet. */
  read<D extends AnyQuery>(def: D, input: InputOf<D>): QueryEntry<OutputOf<D>> {
    const key = QueryCache.key(def, input);
    let rec = this.records.get(key);
    if (!rec) {
      rec = { entry: LOADING, scope: def.scope, def, input, inflight: undefined, listeners: new Set() };
      this.records.set(key, rec);
      void this.fetch(rec);
    }
    return rec.entry as QueryEntry<OutputOf<D>>;
  }

  subscribe(def: AnyQuery, input: unknown, listener: () => void): () => void {
    const key = QueryCache.key(def, input);
    const rec = this.records.get(key) ?? this.ensure(def, input);
    rec.listeners.add(listener);
    return () => {
      rec.listeners.delete(listener);
    };
  }

  refetch(def: AnyQuery, input: unknown): Promise<void> {
    const rec = this.records.get(QueryCache.key(def, input));
    if (!rec) return Promise.resolve();
    return this.fetch(rec);
  }

  /** Re-fetches every record whose scope is listed. Data stays visible while refreshing. */
  invalidate(scopes: readonly string[]): void {
    const set = new Set(scopes);
    for (const rec of this.records.values()) if (set.has(rec.scope)) void this.fetch(rec);
  }

  private ensure(def: AnyQuery, input: unknown): Record_ {
    const key = QueryCache.key(def, input);
    const rec: Record_ = {
      entry: LOADING,
      scope: def.scope,
      def,
      input,
      inflight: undefined,
      listeners: new Set(),
    };
    this.records.set(key, rec);
    void this.fetch(rec);
    return rec;
  }

  private fetch(rec: Record_): Promise<void> {
    if (rec.inflight) return rec.inflight;
    const run = this.dispatcher
      .dispatch(rec.def, rec.input as never)
      .then((data) => {
        this.set(rec, { status: "success", data, error: undefined, version: rec.entry.version + 1 });
      })
      .catch((error: unknown) => {
        this.set(rec, {
          status: "error",
          data: rec.entry.data,
          error: error as AppError,
          version: rec.entry.version + 1,
        });
      })
      .finally(() => {
        rec.inflight = undefined;
      });
    rec.inflight = run;
    return run;
  }

  private set(rec: Record_, entry: QueryEntry<unknown>): void {
    rec.entry = entry;
    for (const l of rec.listeners) l();
  }
}
