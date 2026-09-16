import { createContext, useCallback, useContext, useState, useSyncExternalStore } from "react";
import type { AnyCommand, AnyQuery, AppError, InputOf, OutputOf } from "@autoappz/contracts";
import type { RendererRuntime } from "./runtime.ts";
import type { QueryEntry } from "./query-cache.ts";

export const RuntimeContext = createContext<RendererRuntime | undefined>(undefined);

export function useRuntime(): RendererRuntime {
  const rt = useContext(RuntimeContext);
  if (!rt) throw new Error("RuntimeContext missing");
  return rt;
}

/** Subscribes to a cached query; re-renders on data/error changes and host invalidation. */
export function useQuery<D extends AnyQuery>(
  def: D,
  input: InputOf<D>,
): QueryEntry<OutputOf<D>> & { refetch(): void } {
  const { cache } = useRuntime();
  const subscribe = useCallback((cb: () => void) => cache.subscribe(def, input, cb), [cache, def, input]);
  const getSnapshot = useCallback(() => cache.read(def, input), [cache, def, input]);
  const entry = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const refetch = useCallback(() => {
    void cache.refetch(def, input);
  }, [cache, def, input]);
  return { ...entry, refetch };
}

export interface CommandState<D extends AnyCommand> {
  run(input: InputOf<D>): Promise<OutputOf<D> | undefined>;
  pending: boolean;
  error: AppError | undefined;
  reset(): void;
}

/** Runs a command with pending/error tracking. Errors are returned as state, not thrown into React. */
export function useCommand<D extends AnyCommand>(def: D): CommandState<D> {
  const { client } = useRuntime();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AppError | undefined>();
  const run = useCallback(
    async (input: InputOf<D>) => {
      setPending(true);
      setError(undefined);
      try {
        return await client.dispatch(def, input);
      } catch (e) {
        setError(e as AppError);
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [client, def],
  );
  const reset = useCallback(() => {
    setError(undefined);
  }, []);
  return { run, pending, error, reset };
}
