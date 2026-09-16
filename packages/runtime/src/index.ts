export type RuntimePhase = "install" | "serve" | "build" | "test";

export type ProcessState =
  "pending" | "starting" | "healthy" | "unhealthy" | "stopping" | "stopped" | "failed";

export interface RuntimeProcess {
  readonly id: string;
  readonly projectId: string;
  readonly phase: RuntimePhase;
  readonly state: ProcessState;
  readonly pid: number | undefined;
  readonly port: number | undefined;
  readonly startedAt: number;
}

/** Fixed budgets per phase (docs/architecture/RUNTIME.md). */
export const PHASE_TIMEOUTS_MS: Readonly<Record<RuntimePhase, number>> = {
  install: 15 * 60_000,
  build: 10 * 60_000,
  test: 20 * 60_000,
  serve: 3 * 60_000, // time to first healthy probe
};

export const PORT_RANGES = {
  app: { from: 41_000, to: 41_999 },
  preview: { from: 42_000, to: 42_999 },
} as const;

/** Commands are always executable + argument array; never a shell string. */
export interface SpawnSpec {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export interface RuntimeSupervisor {
  start(projectId: string, phase: RuntimePhase): Promise<RuntimeProcess>;
  stop(processId: string): Promise<void>;
  list(projectId?: string): readonly RuntimeProcess[];
}
