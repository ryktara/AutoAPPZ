import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CommandBusHost } from "@autoappz/command-bus";
import { AppError, runtime as contracts, workspace } from "@autoappz/contracts";
import type { Logger } from "@autoappz/diagnostics";
import type { ProjectCatalog, ProjectSettingsService, TemplateRegistry } from "@autoappz/project";
import {
  PHASE_TIMEOUTS_MS,
  RuntimeSupervisor,
  detectPackageManager,
  resolveExecutable,
  type CommandPlanner,
  type PhaseCommand,
} from "@autoappz/runtime";

/**
 * Decides how each phase runs: template manifest commands when the project came from a bundled template,
 * otherwise package-manager scripts from package.json. Executables are resolved without a shell.
 */
export function createCommandPlanner(input: {
  projects: ProjectCatalog;
  templates: TemplateRegistry;
  projectSettings: ProjectSettingsService;
}): CommandPlanner {
  return {
    packageManager: (projectId) => detectPackageManager(input.projects.get(projectId).path),
    planPhase: (projectId, phase) => {
      const project = input.projects.get(projectId);
      if (input.projectSettings.get(projectId).runtimeProfile === "container") {
        throw new AppError(
          "precondition",
          "runtime.profile_unsupported",
          "The container runtime profile arrives in a later milestone; switch the project to the host profile.",
        );
      }
      const pm = detectPackageManager(project.path);
      const template = project.templateId
        ? input.templates.list().find((t) => t.id === project.templateId)
        : undefined;
      let argv: string[] | undefined;
      if (template) {
        const fromTemplate =
          phase === "install"
            ? template.runtime.install
            : phase === "serve"
              ? template.runtime.dev
              : phase === "build"
                ? template.runtime.build
                : phase === "test"
                  ? template.runtime.test
                  : undefined;
        if (fromTemplate) argv = [...fromTemplate];
      }
      argv ??= scriptCommand(pm, project.path, phase);
      const [name, ...rest] = argv;
      if (!name)
        throw new AppError(
          "precondition",
          "runtime.no_command",
          `No ${phase} command is configured for this project.`,
        );
      const command = resolveExecutable(name);
      if (!command) {
        throw new AppError(
          "precondition",
          "runtime.command_not_found",
          `"${name}" was not found on PATH. Install it (for example Node.js with pnpm) and restart AutoAPPZ.`,
          { details: { command: name } },
        );
      }
      const plan: PhaseCommand = {
        command,
        args: rest,
        cwd: project.path,
        timeoutMs: PHASE_TIMEOUTS_MS[phase],
        portArgs:
          phase === "serve" ? (port) => [template?.runtime.devPortFlag ?? "--port", String(port)] : undefined,
      };
      return Promise.resolve(plan);
    },
  };
}

function scriptCommand(pm: contracts.PackageManager, projectRoot: string, phase: contracts.Phase): string[] {
  if (phase === "install") return [pm, "install"];
  const scripts = readScripts(projectRoot);
  const pick = (candidates: string[]) => candidates.find((s) => s in scripts);
  const script =
    phase === "serve"
      ? pick(["dev", "start", "serve"])
      : phase === "build"
        ? pick(["build"])
        : phase === "test"
          ? pick(["test"])
          : undefined;
  if (!script)
    throw new AppError(
      "precondition",
      "runtime.no_script",
      `package.json has no ${phase} script (looked for ${phase === "serve" ? "dev/start/serve" : phase}).`,
    );
  const run = [pm, "run", script];
  // npm and yarn need "--" before forwarded flags; pnpm and bun forward them directly.
  if (phase === "serve" && (pm === "npm" || pm === "yarn")) run.push("--");
  return run;
}

function readScripts(projectRoot: string): Record<string, string> {
  const file = path.join(projectRoot, "package.json");
  if (!existsSync(file)) return {};
  try {
    const pkg = JSON.parse(readFileSync(file, "utf8")) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

export function createRuntimeSupervisor(input: {
  planner: CommandPlanner;
  bus: CommandBusHost;
  logger: Logger;
  now?: (() => number) | undefined;
}): RuntimeSupervisor {
  const supervisor = new RuntimeSupervisor({ planner: input.planner, logger: input.logger, now: input.now });
  supervisor.onStateChanged((p) => {
    input.bus.publish(contracts.runtimeStateChanged, p);
    input.bus.publish(workspace.cacheInvalidate, { scopes: ["runtime"] });
  });
  supervisor.onDiagnostic((d) => {
    input.bus.publish(contracts.runtimeDiagnostic, d);
    input.bus.publish(workspace.cacheInvalidate, { scopes: ["diagnostics"] });
  });
  return supervisor;
}

export function registerRuntimeHandlers(bus: CommandBusHost, supervisor: RuntimeSupervisor): void {
  bus.handle(contracts.runtimeStatus, ({ projectId }) => supervisor.status(projectId));
  bus.handle(contracts.runtimeStart, ({ projectId, phase }) => supervisor.start(projectId, phase));
  bus.handle(contracts.runtimeStop, ({ projectId, phase }) => supervisor.stop(projectId, phase));
  bus.handle(contracts.runtimeRestart, ({ projectId, phase }) => supervisor.restart(projectId, phase));
  bus.handle(contracts.runtimeLogs, ({ projectId, phase, limit }) =>
    supervisor.logs(projectId, { phase, limit }),
  );
  bus.handle(contracts.runtimeDiagnostics, ({ projectId, limit }) =>
    supervisor.diagnostics(projectId, limit),
  );
  bus.handle(contracts.runtimeClearDiagnostics, ({ projectId }) => {
    supervisor.clearDiagnostics(projectId);
  });
  bus.handle(contracts.runtimeReportPreviewEvent, ({ projectId, event }) => {
    supervisor.reportPreviewEvent(projectId, event);
  });
  bus.handleStream(contracts.runtimeOutput, ({ projectId, afterSeq }, ctx) =>
    outputStream(supervisor, projectId, afterSeq, ctx.signal),
  );
}

/** Replays lines after `afterSeq`, then follows live output until the subscriber cancels. */
async function* outputStream(
  supervisor: RuntimeSupervisor,
  projectId: string,
  afterSeq: number,
  signal: AbortSignal,
): AsyncIterable<contracts.OutputLine> {
  const queue: contracts.OutputLine[] = supervisor.logs(projectId, { afterSeq });
  let last = queue.at(-1)?.seq ?? afterSeq;
  let wake: (() => void) | undefined;
  const off = supervisor.subscribeOutput(projectId, (line) => {
    if (line.seq > last) {
      queue.push(line);
      last = line.seq;
      wake?.();
    }
  });
  const onAbort = () => wake?.();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (!signal.aborted) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
        continue;
      }
      const next = queue.shift();
      if (next !== undefined) yield next;
    }
  } finally {
    off();
    signal.removeEventListener("abort", onAbort);
  }
}
