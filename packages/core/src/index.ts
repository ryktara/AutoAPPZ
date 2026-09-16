/** Injectable clock so time-dependent logic is testable. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface IdGenerator {
  next(prefix: string): string;
}

/** Discriminated result for operations whose failure is an expected outcome, not an exception. */
export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Minimal typed service container. Services are registered once by the composition root
 * (apps/desktop/src/main/services.ts) and resolved by key; no global singletons.
 */
export class ServiceContainer<TServices extends object> {
  private readonly factories = new Map<keyof TServices, () => unknown>();
  private readonly instances = new Map<keyof TServices, unknown>();

  register<K extends keyof TServices>(key: K, factory: () => TServices[K]): this {
    if (this.factories.has(key)) throw new Error("Service already registered: " + String(key));
    this.factories.set(key, factory);
    return this;
  }

  get<K extends keyof TServices>(key: K): TServices[K] {
    if (this.instances.has(key)) return this.instances.get(key) as TServices[K];
    const factory = this.factories.get(key);
    if (!factory) throw new Error("Service not registered: " + String(key));
    const instance = factory() as TServices[K];
    this.instances.set(key, instance);
    return instance;
  }

  has(key: keyof TServices): boolean {
    return this.factories.has(key);
  }
}

export { TaskEventHub } from "./task-event-hub.ts";
export { TaskService, pathsMentioned } from "./task-service.ts";
export type {
  ProjectContextSource,
  RetrievalSource,
  TaskChange,
  ValidationSource,
  ValidationStore,
  TaskServiceOptions,
  TaskVcs,
} from "./task-service.ts";
export { ChangeTracker } from "./change-tracker.ts";
export type { ChangeStore } from "./change-tracker.ts";
