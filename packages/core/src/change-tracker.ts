import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { tasks } from "@autoappz/contracts";

const MAX_SNAPSHOT_BYTES = 200 * 1024;

export interface ChangeStore {
  upsert(taskId: string, change: tasks.TaskChange, at: number): void;
  list(taskId: string): tasks.TaskChange[];
}

interface Snapshot {
  content: string | undefined;
  truncated: boolean;
}

/**
 * Records before/after content for every file a task's mutating tools touch, so the Changes pane can
 * show a diff immediately (git checkpoints add undo in M9). Snapshots are capped in size.
 */
export class ChangeTracker {
  private readonly firstSeen = new Map<string, Map<string, Snapshot>>(); // taskId -> path -> before

  constructor(
    private readonly store: ChangeStore,
    private readonly now: () => number = Date.now,
  ) {}

  /** Call right before a mutating tool runs. Captures the pre-image once per task and path. */
  before(taskId: string, projectRoot: string, relativePaths: readonly string[]): void {
    let seen = this.firstSeen.get(taskId);
    if (!seen) {
      seen = new Map();
      this.firstSeen.set(taskId, seen);
    }
    for (const rel of relativePaths) {
      if (seen.has(rel)) continue;
      seen.set(rel, snapshot(path.join(projectRoot, ...rel.split("/"))));
    }
  }

  /** Call after the tool ran (success or not); compares against the pre-image and stores the change. */
  after(taskId: string, projectRoot: string, relativePaths: readonly string[]): void {
    const seen = this.firstSeen.get(taskId);
    if (!seen) return;
    for (const rel of relativePaths) {
      const pre = seen.get(rel);
      if (!pre) continue;
      const post = snapshot(path.join(projectRoot, ...rel.split("/")));
      if (pre.content === post.content && pre.truncated === post.truncated) continue;
      const kind: tasks.TaskChange["kind"] =
        pre.content === undefined ? "created" : post.content === undefined ? "deleted" : "modified";
      const change: tasks.TaskChange = { path: rel, kind, truncated: pre.truncated || post.truncated };
      if (pre.content !== undefined) change.before = pre.content;
      if (post.content !== undefined) change.after = post.content;
      this.store.upsert(taskId, change, this.now());
    }
  }

  list(taskId: string): tasks.TaskChange[] {
    return this.store.list(taskId);
  }

  /** Paths a tool input refers to, for the tools this milestone ships. */
  static pathsOf(toolId: string, input: unknown): string[] {
    const i = input as Record<string, unknown> | null;
    if (!i) return [];
    switch (toolId) {
      case "fs.write":
      case "fs.patch":
      case "fs.delete":
        return typeof i["path"] === "string" ? [i["path"]] : [];
      case "fs.rename":
        return [i["from"], i["to"]].filter((p): p is string => typeof p === "string");
      default:
        return [];
    }
  }
}

function snapshot(absolute: string): Snapshot {
  if (!existsSync(absolute)) return { content: undefined, truncated: false };
  try {
    const st = statSync(absolute);
    if (st.isDirectory()) return { content: undefined, truncated: false };
    if (st.size > MAX_SNAPSHOT_BYTES) return { content: undefined, truncated: true };
    const buf = readFileSync(absolute);
    if (buf.includes(0)) return { content: undefined, truncated: true };
    return { content: buf.toString("utf8"), truncated: false };
  } catch {
    return { content: undefined, truncated: true };
  }
}
