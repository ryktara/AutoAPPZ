import path from "node:path";
import type { Logger } from "@autoappz/diagnostics";
import { ProjectIndex, type IndexStatus } from "./indexer.ts";
import { retrieve, type ContextPack, type RetrieveRequest } from "./retrieval.ts";

export interface ContextEngineOptions {
  /** Directory holding `<projectId>/index.db`; ":memory:" keeps every index in memory (tests). */
  indexDir: string;
  logger?: Logger | undefined;
  now?: (() => number) | undefined;
  onStatus?: ((projectId: string, status: IndexStatus) => void) | undefined;
}

/**
 * Owns one `ProjectIndex` per open project. Indexing runs in-process but yields between batches so the
 * main process stays responsive; moving it to a utility process is an internal change (ADR-009 addendum).
 */
export class ContextEngine {
  private readonly indexes = new Map<string, ProjectIndex>();
  private readonly roots = new Map<string, string>();
  private readonly o: ContextEngineOptions;

  constructor(options: ContextEngineOptions) {
    this.o = options;
  }

  /** Opens (or returns) the index for a project rooted at `root`. */
  open(projectId: string, root: string): ProjectIndex {
    const existing = this.indexes.get(projectId);
    if (existing && this.roots.get(projectId) === root) return existing;
    existing?.close();
    const dbFile =
      this.o.indexDir === ":memory:" ? ":memory:" : path.join(this.o.indexDir, projectId, "index.db");
    const index = new ProjectIndex({
      root,
      dbFile,
      logger: this.o.logger?.child(`index:${projectId}`),
      now: this.o.now,
    });
    this.indexes.set(projectId, index);
    this.roots.set(projectId, root);
    return index;
  }

  get(projectId: string): ProjectIndex | undefined {
    return this.indexes.get(projectId);
  }

  /** Runs a full index if none completed yet (or `force`), emitting status changes. */
  async ensureIndexed(
    projectId: string,
    root: string,
    options: { force?: boolean | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<IndexStatus> {
    const index = this.open(projectId, root);
    const current = index.status();
    if (!options.force && current.state === "ready") return current;
    this.o.onStatus?.(projectId, { ...current, state: "indexing" });
    const status = await index.fullIndex(options.signal);
    this.o.onStatus?.(projectId, status);
    return status;
  }

  status(projectId: string): IndexStatus {
    return this.indexes.get(projectId)?.status() ?? { state: "idle", files: 0, indexed: 0 };
  }

  /** Re-indexes changed paths immediately (tool writes, git operations). */
  notifyChanged(
    projectId: string,
    paths: readonly string[],
    activity?: {
      actor: "agent" | "user";
      taskId?: string | undefined;
      kind?: "edit" | "create" | "delete" | undefined;
    },
  ): void {
    const index = this.indexes.get(projectId);
    if (!index || paths.length === 0) return;
    index.indexPaths(paths);
    if (activity) index.recordActivity(paths, activity.kind ?? "edit", activity.actor, activity.taskId);
    this.o.onStatus?.(projectId, index.status());
  }

  retrieve(projectId: string, root: string, req: RetrieveRequest): ContextPack {
    return retrieve(this.open(projectId, root), req);
  }

  close(projectId?: string): void {
    const ids = projectId ? [projectId] : [...this.indexes.keys()];
    for (const id of ids) {
      this.indexes.get(id)?.close();
      this.indexes.delete(id);
      this.roots.delete(id);
    }
  }
}
