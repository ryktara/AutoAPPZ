import { spawn, type ChildProcess } from "node:child_process";
import { AppError, type runtime as contracts } from "@autoappz/contracts";
import type { Logger } from "@autoappz/diagnostics";
import { buildChildEnv, type ResolvedCommand } from "./command.ts";
import { extractDiagnostic } from "./diagnostics.ts";
import { LineSplitter, OutputRing, stripAnsi } from "./output.ts";
import { PROXY_BAND, PortLeaseRegistry, SERVE_BAND, type PortLease } from "./ports.ts";
import { httpProbe, killTree, sleep } from "./process.ts";
import { startPreviewProxy, type PreviewProxy } from "./proxy.ts";

type Phase = contracts.Phase;
type ProcessState = contracts.ProcessState;
type RuntimeProcess = contracts.RuntimeProcess;
type RuntimeDiagnostic = contracts.RuntimeDiagnostic;
type PreviewEvent = contracts.PreviewEvent;

/** How to run one phase of a project, decided by the composition root (templates, package.json scripts). */
export interface PhaseCommand {
  readonly command: ResolvedCommand;
  readonly args: readonly string[];
  readonly cwd: string;
  /** For `serve`: how the leased port is passed (`["--port", "<port>"]` appended when set). */
  readonly portArgs?: ((port: number) => readonly string[]) | undefined;
  readonly timeoutMs: number;
  readonly env?: Record<string, string> | undefined;
}

export interface CommandPlanner {
  planPhase(projectId: string, phase: Phase): Promise<PhaseCommand>;
  packageManager(projectId: string): contracts.PackageManager;
}

export interface SupervisorOptions {
  planner: CommandPlanner;
  logger?: Logger | undefined;
  now?: (() => number) | undefined;
  newId?: (() => string) | undefined;
  ports?: PortLeaseRegistry | undefined;
  probe?: ((url: string) => Promise<boolean>) | undefined;
  /** Health probe interval while RUNNING. */
  healthIntervalMs?: number | undefined;
  /** Consecutive probe failures before DEGRADED. */
  degradedAfter?: number | undefined;
  /** Serve readiness probe cadence. */
  readinessIntervalMs?: number | undefined;
  maxAutoRestarts?: number | undefined;
  backoffBaseMs?: number | undefined;
  backoffMaxMs?: number | undefined;
  killGraceMs?: number | undefined;
  /** Attach the preview proxy to serve processes (disabled in some tests). */
  previewProxy?: boolean | undefined;
}

interface Managed {
  info: RuntimeProcess;
  child?: ChildProcess | undefined;
  lease?: PortLease | undefined;
  proxy?: PreviewProxy | undefined;
  proxyLease?: PortLease | undefined;
  healthTimer?: ReturnType<typeof setInterval> | undefined;
  timeoutTimer?: ReturnType<typeof setTimeout> | undefined;
  stopping: boolean;
  restartTimes: number[];
  wasRunning: boolean;
}

interface ProjectRuntime {
  phases: Map<Phase, Managed>;
  output: OutputRing;
  diagnostics: RuntimeDiagnostic[];
}

/**
 * Runtime Supervisor (ADR-007). Every project process is a supervised child with explicit state,
 * argument-array spawning, env allowlist, bounded output, timeouts, health probes, crash backoff and
 * tree termination. Ports come from reserved bands; foreign listeners are skipped, never killed.
 */
export class RuntimeSupervisor {
  private readonly projects = new Map<string, ProjectRuntime>();
  private readonly stateListeners = new Set<(p: RuntimeProcess) => void>();
  private readonly diagListeners = new Set<(d: RuntimeDiagnostic) => void>();
  private readonly o: SupervisorOptions;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly ports: PortLeaseRegistry;
  private readonly probe: (url: string) => Promise<boolean>;

  constructor(options: SupervisorOptions) {
    this.o = options;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? defaultId;
    this.ports = options.ports ?? new PortLeaseRegistry();
    this.probe = options.probe ?? ((url) => httpProbe(url));
  }

  onStateChanged(l: (p: RuntimeProcess) => void): () => void {
    this.stateListeners.add(l);
    return () => {
      this.stateListeners.delete(l);
    };
  }

  onDiagnostic(l: (d: RuntimeDiagnostic) => void): () => void {
    this.diagListeners.add(l);
    return () => {
      this.diagListeners.delete(l);
    };
  }

  status(projectId: string): contracts.RuntimeStatus {
    const rt = this.projects.get(projectId);
    const processes: RuntimeProcess[] = [];
    for (const phase of ["install", "serve", "build", "test"] as const) {
      processes.push(rt?.phases.get(phase)?.info ?? { projectId, phase, state: "STOPPED", restarts: 0 });
    }
    const serve = rt?.phases.get("serve")?.info;
    const status: contracts.RuntimeStatus = {
      projectId,
      packageManager: this.o.planner.packageManager(projectId),
      processes,
    };
    if (serve?.previewUrl && (serve.state === "RUNNING" || serve.state === "DEGRADED"))
      status.previewUrl = serve.previewUrl;
    return status;
  }

  logs(
    projectId: string,
    options: { phase?: Phase | undefined; afterSeq?: number | undefined; limit?: number | undefined } = {},
  ): contracts.OutputLine[] {
    return this.projects.get(projectId)?.output.list(options) ?? [];
  }

  subscribeOutput(projectId: string, listener: (line: contracts.OutputLine) => void): () => void {
    return this.project(projectId).output.subscribe(listener);
  }

  diagnostics(projectId: string, limit = 100): RuntimeDiagnostic[] {
    return (this.projects.get(projectId)?.diagnostics ?? []).slice(-limit);
  }

  clearDiagnostics(projectId: string): void {
    const rt = this.projects.get(projectId);
    if (rt) rt.diagnostics.length = 0;
  }

  /** Records what the preview instrumentation reported (already validated by the contract). */
  reportPreviewEvent(projectId: string, event: PreviewEvent): void {
    const rt = this.project(projectId);
    rt.output.push(
      "serve",
      "system",
      `[preview] ${event.type}${event.message ? `: ${event.message}` : ""}${event.url ? ` (${event.url})` : ""}`,
    );
    if (
      event.type === "error" ||
      event.type === "unhandledrejection" ||
      event.type === "blank" ||
      (event.type === "console" && event.level === "error") ||
      (event.type === "network" && (event.status ?? 0) >= 500)
    ) {
      const d: RuntimeDiagnostic = {
        id: this.newId(),
        projectId,
        source: "preview",
        phase: "preview",
        severity: event.type === "console" ? "warning" : "error",
        message: event.message ?? event.type,
        at: this.now(),
      };
      if (event.stack !== undefined) d.stack = event.stack;
      if (event.url !== undefined) d.file = event.url;
      this.addDiagnostic(rt, d);
    }
  }

  async start(projectId: string, phase: Phase): Promise<RuntimeProcess> {
    const rt = this.project(projectId);
    const existing = rt.phases.get(phase);
    if (existing && existing.info.state !== "STOPPED" && existing.info.state !== "CRASHED") {
      throw new AppError(
        "conflict",
        "runtime.already_running",
        `${phase} is already ${existing.info.state.toLowerCase()}.`,
      );
    }
    const plan = await this.o.planner.planPhase(projectId, phase);
    const managed: Managed = {
      info: {
        projectId,
        phase,
        state: "STARTING",
        invocationId: this.newId(),
        startedAt: this.now(),
        restarts: existing?.info.restarts ?? 0,
      },
      stopping: false,
      restartTimes: existing?.restartTimes ?? [],
      wasRunning: false,
    };
    rt.phases.set(phase, managed);
    this.emit(managed);
    await this.launch(rt, managed, plan);
    return managed.info;
  }

  async stop(projectId: string, phase: Phase): Promise<void> {
    const rt = this.projects.get(projectId);
    const managed = rt?.phases.get(phase);
    if (!rt || !managed || managed.info.state === "STOPPED") return;
    managed.stopping = true;
    this.setState(managed, "STOPPING");
    this.clearTimers(managed);
    if (managed.child) await killTree(managed.child, this.o.killGraceMs ?? 5_000);
    await this.teardown(managed);
    managed.info = {
      ...managed.info,
      state: "STOPPED",
      pid: undefined,
      exit: managed.info.exit ?? { code: null, signal: "SIGTERM", classified: "killed" },
    };
    this.emit(managed);
  }

  async restart(projectId: string, phase: Phase): Promise<RuntimeProcess> {
    await this.stop(projectId, phase);
    return this.start(projectId, phase);
  }

  async stopAll(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const [projectId, rt] of this.projects)
      for (const phase of rt.phases.keys()) jobs.push(this.stop(projectId, phase));
    await Promise.all(jobs);
  }

  // ---------------------------------------------------------------- internals

  private async launch(rt: ProjectRuntime, managed: Managed, plan: PhaseCommand): Promise<void> {
    const { projectId, phase } = managed.info;
    const args = [...plan.command.args, ...plan.args];
    let lease: PortLease | undefined;
    if (phase === "serve") {
      const leased = await this.ports.lease(`${projectId}:serve`, SERVE_BAND);
      lease = leased;
      if (leased.skipped.length > 0)
        rt.output.push(
          phase,
          "system",
          `Ports in use by other processes were skipped: ${leased.skipped.join(", ")}. Using ${String(leased.port)}.`,
        );
      if (plan.portArgs) args.push(...plan.portArgs(leased.port));
      managed.lease = lease;
      managed.info = { ...managed.info, port: leased.port };
    }
    rt.output.push(phase, "system", `$ ${[plan.command.file, ...args].map(quote).join(" ")}`);

    let child: ChildProcess;
    try {
      child = spawn(plan.command.file, args, {
        cwd: plan.cwd,
        env: buildChildEnv(process.env, {
          ...(plan.env ?? {}),
          ...(lease ? { PORT: String(lease.port) } : {}),
        }),
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch (error) {
      await this.fail(
        rt,
        managed,
        `Could not start: ${error instanceof Error ? error.message : String(error)}`,
        { code: null, signal: null, classified: "error" },
      );
      return;
    }
    managed.child = child;
    managed.info = { ...managed.info, pid: child.pid ?? undefined };
    child.on("error", (error) => {
      void this.fail(rt, managed, `Process error: ${error.message}`, {
        code: null,
        signal: null,
        classified: "error",
      });
    });
    this.pipeOutput(rt, managed, child);

    managed.timeoutTimer = setTimeout(() => {
      if (managed.info.state === "STARTING" || (phase !== "serve" && managed.info.state === "RUNNING")) {
        rt.output.push(phase, "system", `Timed out after ${String(Math.round(plan.timeoutMs / 1000))} s.`);
        managed.info = { ...managed.info, exit: { code: null, signal: null, classified: "timeout" } };
        void this.stop(projectId, phase).then(() => {
          managed.info = { ...managed.info, state: "CRASHED", lastError: "Timed out" };
          this.emit(managed);
        });
      }
    }, plan.timeoutMs);
    managed.timeoutTimer.unref?.();

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("exit", (code, signal) => {
        resolve({ code, signal });
      });
    });
    void exited.then(({ code, signal }) => this.onExit(rt, managed, plan, code, signal));

    if (phase === "serve" && lease) {
      await this.awaitReadiness(rt, managed, lease.port, plan.timeoutMs);
    } else {
      this.setState(managed, "RUNNING");
      managed.wasRunning = true;
    }
  }

  private async awaitReadiness(
    rt: ProjectRuntime,
    managed: Managed,
    port: number,
    timeoutMs: number,
  ): Promise<void> {
    let url = `http://127.0.0.1:${String(port)}/`;
    const interval = this.o.readinessIntervalMs ?? 250;
    const deadline = this.now() + timeoutMs;
    // Dev servers that ignore the leased port still print where they listen; adopt that as a fallback.
    let announced: number | undefined;
    const offOutput = rt.output.subscribe((line) => {
      if (line.phase !== "serve") return;
      const m = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\/?/.exec(line.text);
      if (m?.[1]) announced = Number(m[1]);
    });
    try {
      while (managed.info.state === "STARTING" && this.now() < deadline) {
        let ok = await this.probe(url);
        if (!ok && announced !== undefined && announced !== port) {
          const alt = `http://127.0.0.1:${String(announced)}/`;
          if (await this.probe(alt)) {
            rt.output.push(
              "serve",
              "system",
              `The dev server listens on ${String(announced)} instead of the leased port ${String(port)}; using it.`,
            );
            port = announced;
            url = alt;
            managed.info = { ...managed.info, port };
            ok = true;
          }
        }
        if (!ok) {
          await sleep(interval);
          continue;
        }
        if (managed.info.state !== "STARTING") return; // exited meanwhile
        if (this.o.previewProxy !== false) {
          const proxyLease = await this.ports.lease(`${managed.info.projectId}:proxy`, PROXY_BAND);
          managed.proxyLease = proxyLease;
          managed.proxy = await startPreviewProxy({ port: proxyLease.port, targetPort: port });
          managed.info = { ...managed.info, previewUrl: managed.proxy.url };
        } else {
          managed.info = { ...managed.info, previewUrl: url };
        }
        managed.wasRunning = true;
        this.clearTimers(managed);
        managed.info = { ...managed.info, health: { lastOkAt: this.now(), failures: 0 } };
        this.setState(managed, "RUNNING");
        rt.output.push(
          "serve",
          "system",
          `Ready at ${url}${managed.proxy ? ` (preview ${managed.proxy.url})` : ""}`,
        );
        this.startHealthLoop(rt, managed, url);
        return;
      }
    } finally {
      offOutput();
    }
  }

  private startHealthLoop(rt: ProjectRuntime, managed: Managed, url: string): void {
    const every = this.o.healthIntervalMs ?? 5_000;
    const threshold = this.o.degradedAfter ?? 3;
    managed.healthTimer = setInterval(() => {
      void this.probe(url).then((ok) => {
        if (managed.info.state !== "RUNNING" && managed.info.state !== "DEGRADED") return;
        const failures = ok ? 0 : (managed.info.health?.failures ?? 0) + 1;
        const health = { ...(managed.info.health ?? {}), failures, ...(ok ? { lastOkAt: this.now() } : {}) };
        managed.info = { ...managed.info, health };
        if (!ok && failures >= threshold && managed.info.state === "RUNNING") {
          rt.output.push(
            "serve",
            "system",
            `Health probe failed ${String(failures)} times; marking DEGRADED.`,
          );
          this.setState(managed, "DEGRADED");
        } else if (ok && managed.info.state === "DEGRADED") {
          rt.output.push("serve", "system", "Health probe recovered.");
          this.setState(managed, "RUNNING");
        } else {
          this.emit(managed);
        }
      });
    }, every);
    managed.healthTimer.unref?.();
  }

  private pipeOutput(rt: ProjectRuntime, managed: Managed, child: ChildProcess): void {
    const { projectId, phase } = managed.info;
    const attach = (stream: NodeJS.ReadableStream | null, kind: "stdout" | "stderr") => {
      if (!stream) return;
      const splitter = new LineSplitter();
      const emitLine = (raw: string) => {
        const text = stripAnsi(raw);
        rt.output.push(phase, kind, text);
        const extracted = extractDiagnostic(phase, text);
        if (extracted) this.addDiagnostic(rt, { ...extracted, id: this.newId(), projectId, at: this.now() });
      };
      stream.on("data", (chunk: Buffer) => {
        for (const line of splitter.push(chunk.toString("utf8"))) emitLine(line);
      });
      stream.on("end", () => {
        for (const line of splitter.flush()) emitLine(line);
      });
    };
    attach(child.stdout, "stdout");
    attach(child.stderr, "stderr");
  }

  private async onExit(
    rt: ProjectRuntime,
    managed: Managed,
    plan: PhaseCommand,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    const { phase, projectId } = managed.info;
    if (managed.stopping) return; // stop() reports the final state
    this.clearTimers(managed);
    const classified: contracts.ExitInfo["classified"] = signal ? "killed" : code === 0 ? "clean" : "error";
    const exit: contracts.ExitInfo = { code, signal, classified };
    rt.output.push(
      phase,
      "system",
      `Process exited (${classified}${code !== null ? `, code ${String(code)}` : ""}${signal ? `, ${signal}` : ""}).`,
    );
    await this.teardown(managed);

    if (phase !== "serve") {
      managed.info = {
        ...managed.info,
        state: classified === "clean" ? "STOPPED" : "CRASHED",
        exit,
        pid: undefined,
        ...(classified !== "clean" ? { lastError: `${phase} failed (exit code ${String(code)})` } : {}),
      };
      if (classified !== "clean")
        this.addDiagnostic(rt, {
          id: this.newId(),
          projectId,
          source: phase === "install" ? "install" : "runtime",
          phase,
          severity: "error",
          message: `${phase} exited with code ${String(code)}`,
          at: this.now(),
        });
      this.emit(managed);
      return;
    }

    // serve: crash backoff with limits, only after it had been running
    const nowMs = this.now();
    managed.restartTimes = managed.restartTimes.filter((t) => nowMs - t < 10 * 60_000);
    const limit = this.o.maxAutoRestarts ?? 5;
    if (!managed.wasRunning || managed.restartTimes.length >= limit) {
      managed.info = {
        ...managed.info,
        state: "CRASHED",
        exit,
        pid: undefined,
        lastError: managed.wasRunning
          ? `Crashed ${String(managed.restartTimes.length)} times in 10 minutes; not restarting automatically.`
          : `Exited before becoming ready (code ${String(code)}).`,
      };
      this.addDiagnostic(rt, {
        id: this.newId(),
        projectId,
        source: "runtime",
        phase,
        severity: "error",
        message: managed.info.lastError ?? "crashed",
        at: nowMs,
      });
      // A dev server that never became ready is the one failure users cannot see in the preview; keep its
      // last output lines in the main log (already redacted by the sink) so the cause survives the session.
      this.o.logger?.warn("serve process crashed", {
        projectId,
        code,
        wasRunning: managed.wasRunning,
        tail: rt.output
          .list({ phase, limit: 12 })
          .map((l) => l.text)
          .join("\n"),
      });
      this.emit(managed);
      return;
    }
    const attempt = managed.restartTimes.length;
    const delay = Math.min((this.o.backoffBaseMs ?? 1_000) * 2 ** attempt, this.o.backoffMaxMs ?? 30_000);
    managed.restartTimes.push(nowMs);
    managed.info = {
      ...managed.info,
      state: "RESTARTING",
      exit,
      pid: undefined,
      restarts: managed.info.restarts + 1,
    };
    this.emit(managed);
    rt.output.push(
      phase,
      "system",
      `Restarting in ${String(Math.round(delay / 1000))} s (attempt ${String(attempt + 1)}/${String(limit)}).`,
    );
    await sleep(delay);
    if (managed.stopping || rt.phases.get(phase) !== managed) return;
    managed.info = { ...managed.info, state: "STARTING", invocationId: this.newId(), startedAt: this.now() };
    managed.wasRunning = false;
    this.emit(managed);
    await this.launch(rt, managed, plan);
  }

  private async fail(
    rt: ProjectRuntime,
    managed: Managed,
    message: string,
    exit: contracts.ExitInfo,
  ): Promise<void> {
    rt.output.push(managed.info.phase, "system", message);
    this.clearTimers(managed);
    await this.teardown(managed);
    managed.info = { ...managed.info, state: "CRASHED", exit, lastError: message, pid: undefined };
    this.addDiagnostic(rt, {
      id: this.newId(),
      projectId: managed.info.projectId,
      source: "runtime",
      phase: managed.info.phase,
      severity: "error",
      message,
      at: this.now(),
    });
    this.emit(managed);
  }

  private async teardown(managed: Managed): Promise<void> {
    this.clearTimers(managed);
    if (managed.proxy) {
      await managed.proxy.close();
      managed.proxy = undefined;
    }
    managed.proxyLease?.release();
    managed.proxyLease = undefined;
    managed.lease?.release();
    managed.lease = undefined;
    managed.child = undefined;
    managed.info = { ...managed.info, previewUrl: undefined };
  }

  private clearTimers(managed: Managed): void {
    if (managed.healthTimer) clearInterval(managed.healthTimer);
    if (managed.timeoutTimer) clearTimeout(managed.timeoutTimer);
    managed.healthTimer = undefined;
    managed.timeoutTimer = undefined;
  }

  private setState(managed: Managed, state: ProcessState): void {
    managed.info = { ...managed.info, state };
    this.emit(managed);
  }

  private emit(managed: Managed): void {
    for (const l of this.stateListeners) l(managed.info);
  }

  private addDiagnostic(rt: ProjectRuntime, d: RuntimeDiagnostic): void {
    rt.diagnostics.push(d);
    if (rt.diagnostics.length > 500) rt.diagnostics.splice(0, rt.diagnostics.length - 500);
    for (const l of this.diagListeners) l(d);
  }

  private project(projectId: string): ProjectRuntime {
    let rt = this.projects.get(projectId);
    if (!rt) {
      rt = { phases: new Map(), output: new OutputRing(5_000, this.now), diagnostics: [] };
      this.projects.set(projectId, rt);
    }
    return rt;
  }
}

function quote(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
}

function defaultId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let out = "run_";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
