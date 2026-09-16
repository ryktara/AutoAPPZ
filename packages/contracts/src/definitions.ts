import type { z } from "zod";

/**
 * Contract definitions are the single source of truth for names and schemas.
 * They are pure data: no transport, no runtime behaviour.
 */

export type ContractKind = "command" | "query" | "event" | "stream";

export interface CommandDefinition<N extends string, I extends z.ZodType, O extends z.ZodType> {
  readonly kind: "command";
  readonly name: N;
  readonly input: I;
  readonly output: O;
  /** Cache scopes invalidated when the command succeeds. */
  readonly invalidates: readonly string[];
}

export interface QueryDefinition<N extends string, I extends z.ZodType, O extends z.ZodType> {
  readonly kind: "query";
  readonly name: N;
  readonly input: I;
  readonly output: O;
  /** Cache scope this query belongs to (for invalidation). */
  readonly scope: string;
}

export interface EventDefinition<N extends string, P extends z.ZodType> {
  readonly kind: "event";
  readonly name: N;
  readonly payload: P;
}

export interface StreamDefinition<N extends string, I extends z.ZodType, C extends z.ZodType> {
  readonly kind: "stream";
  readonly name: N;
  readonly input: I;
  readonly chunk: C;
}

export type AnyCommand = CommandDefinition<string, z.ZodType, z.ZodType>;
export type AnyQuery = QueryDefinition<string, z.ZodType, z.ZodType>;
export type AnyEvent = EventDefinition<string, z.ZodType>;
export type AnyStream = StreamDefinition<string, z.ZodType, z.ZodType>;
export type AnyDefinition = AnyCommand | AnyQuery | AnyEvent | AnyStream;

const NAME_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

function assertName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid contract name "${name}": expected dotted camelCase like "project.create".`);
  }
}

export function defineCommand<N extends string, I extends z.ZodType, O extends z.ZodType>(def: {
  name: N;
  input: I;
  output: O;
  invalidates?: readonly string[];
}): CommandDefinition<N, I, O> {
  assertName(def.name);
  return {
    kind: "command",
    name: def.name,
    input: def.input,
    output: def.output,
    invalidates: def.invalidates ?? [],
  };
}

export function defineQuery<N extends string, I extends z.ZodType, O extends z.ZodType>(def: {
  name: N;
  input: I;
  output: O;
  scope: string;
}): QueryDefinition<N, I, O> {
  assertName(def.name);
  return { kind: "query", name: def.name, input: def.input, output: def.output, scope: def.scope };
}

export function defineEvent<N extends string, P extends z.ZodType>(def: {
  name: N;
  payload: P;
}): EventDefinition<N, P> {
  assertName(def.name);
  return { kind: "event", name: def.name, payload: def.payload };
}

export function defineStream<N extends string, I extends z.ZodType, C extends z.ZodType>(def: {
  name: N;
  input: I;
  chunk: C;
}): StreamDefinition<N, I, C> {
  assertName(def.name);
  return { kind: "stream", name: def.name, input: def.input, chunk: def.chunk };
}

export type InputOf<D> = D extends { input: infer I extends z.ZodType } ? z.output<I> : never;
export type OutputOf<D> = D extends { output: infer O extends z.ZodType } ? z.output<O> : never;
export type PayloadOf<D> = D extends { payload: infer P extends z.ZodType } ? z.output<P> : never;
export type ChunkOf<D> = D extends { chunk: infer C extends z.ZodType } ? z.output<C> : never;
