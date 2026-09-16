import { rmSync } from "node:fs";
import path from "node:path";
import type { CommandBusHost } from "@autoappz/command-bus";
import { ContextEngine, createContextTools, renderContextForPrompt } from "@autoappz/context";
import { context as contracts, workspace } from "@autoappz/contracts";
import type { RetrievalSource } from "@autoappz/core";
import type { Logger } from "@autoappz/diagnostics";
import type { ProjectCatalog } from "@autoappz/project";
import type { AnyTool } from "@autoappz/tools";

export interface ContextWiring {
  engine: ContextEngine;
  retrieval: RetrievalSource;
  tools: AnyTool[];
  /** Starts (or resumes) indexing in the background; safe to call on every project open. */
  warm(projectId: string): void;
  forget(projectId: string): void;
  close(): void;
}

/**
 * Composition of the context engine: per-project indexes under `<dataDir>/context/<projectId>/index.db`,
 * status events on the bus, agent tools and the task runner's retrieval port.
 */
export function createContextWiring(input: {
  bus: CommandBusHost;
  projects: ProjectCatalog;
  dataDirectory: string;
  logger: Logger;
  now?: (() => number) | undefined;
}): ContextWiring {
  const indexDir =
    input.dataDirectory === ":memory:" ? ":memory:" : path.join(input.dataDirectory, "context");
  const engine = new ContextEngine({
    indexDir,
    logger: input.logger,
    now: input.now,
    onStatus: (projectId, status) => {
      input.bus.publish(contracts.contextStatusChanged, { projectId, status });
      input.bus.publish(workspace.cacheInvalidate, { scopes: ["context"] });
    },
  });
  const warm = (projectId: string) => {
    const project = input.projects.get(projectId);
    engine.ensureIndexed(projectId, project.path).catch((error: unknown) => {
      input.logger.warn("background indexing failed", { projectId, message: String(error) });
    });
  };
  const retrieval: RetrievalSource = {
    retrieve(req) {
      const pack = engine.retrieve(req.projectId, req.projectPath, {
        query: req.query,
        phase: req.phase,
        budget: { total: req.budgetTokens },
        selections: req.selections,
        taskId: req.taskId,
      });
      // First use on a never-indexed project: serve what exists now and index in the background.
      if (engine.status(req.projectId).state === "idle") warm(req.projectId);
      return {
        rendered: renderContextForPrompt(pack),
        items: pack.items.map((i) => ({
          path: i.path,
          startLine: i.startLine,
          endLine: i.endLine,
          kind: i.kind,
          tokens: i.tokens,
          reasons: i.reasons.map((r) => r.detail),
        })),
        usedTokens: pack.used,
        budgetTokens: pack.budget.total,
      };
    },
    notifyChanged(req) {
      engine.open(req.projectId, req.projectPath);
      engine.notifyChanged(req.projectId, req.paths, { actor: "agent", taskId: req.taskId });
    },
  };
  return {
    engine,
    retrieval,
    tools: createContextTools(engine),
    warm,
    forget(projectId) {
      engine.close(projectId);
      if (indexDir !== ":memory:") rmSync(path.join(indexDir, projectId), { recursive: true, force: true });
    },
    close() {
      engine.close();
    },
  };
}

export function registerContextHandlers(
  bus: CommandBusHost,
  wiring: ContextWiring,
  projects: ProjectCatalog,
): void {
  bus.handle(contracts.contextStatus, ({ projectId }) => {
    projects.get(projectId);
    return wiring.engine.status(projectId);
  });
  bus.handle(contracts.contextReindex, ({ projectId }) =>
    wiring.engine.ensureIndexed(projectId, projects.get(projectId).path, { force: true }),
  );
  bus.handle(contracts.contextSearch, ({ projectId, query, limit }) => {
    const index = wiring.engine.open(projectId, projects.get(projectId).path);
    return index.search(query, { limit }).map((h) => ({
      path: h.path,
      startLine: h.startLine,
      endLine: h.endLine,
      kind: h.kind,
      score: Number(h.score.toFixed(2)),
      snippet: h.text.split("\n").slice(0, 4).join("\n").slice(0, 300),
    }));
  });
}
