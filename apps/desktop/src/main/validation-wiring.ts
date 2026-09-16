import type { CommandBusHost } from "@autoappz/command-bus";
import type { ContextEngine } from "@autoappz/context";
import { AppError, validation as contracts, workspace } from "@autoappz/contracts";
import type { TaskService, ValidationSource } from "@autoappz/core";
import type { Logger } from "@autoappz/diagnostics";
import type { GitService } from "@autoappz/git";
import type { ProjectCatalog } from "@autoappz/project";
import type { TaskValidationsRepository } from "@autoappz/storage";
import {
  createDefaultValidators,
  renderRepairNotes,
  runValidation,
  selectDiagnostics,
  summarizeReport,
  type ValidationReport as PackageReport,
  type ValidatorTier,
} from "@autoappz/validation";

type ValidationReport = contracts.ValidationReport;

/** Which cost tier a task profile runs up to: trivial → syntax/typecheck/lint, standard → +tests, complex → +build. */
export function tierFor(complexity: "trivial" | "standard" | "complex"): ValidatorTier {
  return complexity === "trivial" ? 1 : complexity === "standard" ? 2 : 3;
}

/** The validation package uses readonly arrays; the bus contract (zod) infers mutable ones. */
function toContract(report: PackageReport): ValidationReport {
  return {
    ...report,
    results: report.results.map((r) => ({ ...r, diagnostics: [...r.diagnostics] })),
    diagnostics: [...report.diagnostics],
  };
}

export interface ValidationWiring {
  source: ValidationSource;
  runForProject(projectId: string, tier: ValidatorTier, signal: AbortSignal): Promise<ValidationReport>;
  latest(projectId: string): { report?: ValidationReport | undefined; running: boolean };
}

export function createValidationWiring(input: {
  bus: CommandBusHost;
  projects: ProjectCatalog;
  git: GitService;
  context: ContextEngine;
  logger: Logger;
  now?: (() => number) | undefined;
}): ValidationWiring {
  const validators = createDefaultValidators();
  const latest = new Map<string, ValidationReport>();
  const running = new Set<string>();

  const feedContext = (projectId: string, projectPath: string, report: PackageReport) => {
    // Diagnostics become a retrieval signal (repair phase weights them highest).
    const index = input.context.open(projectId, projectPath);
    index.setDiagnostics(
      "validation",
      report.diagnostics
        .filter((d) => d.file !== undefined)
        .map((d) => ({
          path: d.file ?? "",
          line: d.line,
          code: d.code,
          message: `${d.validator}: ${d.message}`,
        })),
    );
  };

  const run = async (
    projectId: string,
    projectPath: string,
    changedPaths: readonly string[],
    tier: ValidatorTier,
    attempt: number,
    signal: AbortSignal,
  ) => {
    let paths = changedPaths;
    if (paths.length === 0) {
      // Nothing recorded for the task: validate whatever is uncommitted in the tree.
      const status = await input.git.status(projectPath);
      paths = [...status.modified, ...status.untracked];
    }
    const report = await runValidation({
      projectRoot: projectPath,
      changedPaths: paths,
      signal,
      maxTier: tier,
      attempt,
      validators,
      logger: input.logger,
      now: input.now,
    });
    feedContext(projectId, projectPath, report);
    return toContract(report);
  };

  const source: ValidationSource = {
    validate: (req) =>
      run(req.projectId, req.projectPath, req.changedPaths, tierFor(req.complexity), req.attempt, req.signal),
    repairNotes: (report, changedPaths) => renderRepairNotes(selectDiagnostics(report, changedPaths), report),
    summarize: summarizeReport,
  };

  return {
    source,
    async runForProject(projectId, tier, signal) {
      if (running.has(projectId))
        throw new AppError("conflict", "validation.running", "Checks are already running for this project.");
      running.add(projectId);
      input.bus.publish(workspace.cacheInvalidate, { scopes: ["validation"] });
      try {
        const report = await run(projectId, input.projects.get(projectId).path, [], tier, 0, signal);
        latest.set(projectId, report);
        return report;
      } finally {
        running.delete(projectId);
        input.bus.publish(contracts.validationChanged, { projectId });
        input.bus.publish(workspace.cacheInvalidate, { scopes: ["validation"] });
      }
    },
    latest(projectId) {
      const report = latest.get(projectId);
      return { ...(report ? { report } : {}), running: running.has(projectId) };
    },
  };
}

export function registerValidationHandlers(
  bus: CommandBusHost,
  wiring: ValidationWiring,
  input: { tasks: TaskService; validations: TaskValidationsRepository; projects: ProjectCatalog },
): void {
  bus.handle(contracts.taskValidation, ({ taskId }) => {
    input.tasks.get(taskId);
    return input.validations.list(taskId);
  });
  bus.handle(contracts.validationRun, ({ projectId, tier }, ctx) => {
    input.projects.get(projectId);
    return wiring.runForProject(projectId, tier as ValidatorTier, ctx.signal);
  });
  bus.handle(contracts.validationLatest, ({ projectId }) => {
    input.projects.get(projectId);
    return wiring.latest(projectId);
  });
}
