import { desc, eq } from "drizzle-orm";
import type { git as contracts } from "@autoappz/contracts";
import type { PlatformDb } from "../database.ts";
import { checkpoints, tasks } from "../schema.ts";

type Checkpoint = contracts.Checkpoint;

export class CheckpointsRepository {
  constructor(private readonly db: PlatformDb) {}

  byTask(taskId: string): Checkpoint | undefined {
    const row = this.db.select().from(checkpoints).where(eq(checkpoints.taskId, taskId)).get();
    return row ? toCheckpoint(row) : undefined;
  }

  listForProject(projectId: string, limit = 50): (Checkpoint & { request?: string; taskState?: string })[] {
    return this.db
      .select({ c: checkpoints, request: tasks.request, state: tasks.state })
      .from(checkpoints)
      .leftJoin(tasks, eq(tasks.id, checkpoints.taskId))
      .where(eq(checkpoints.projectId, projectId))
      .orderBy(desc(checkpoints.createdAt))
      .limit(limit)
      .all()
      .map((r) => {
        const c: Checkpoint & { request?: string; taskState?: string } = toCheckpoint(r.c);
        if (r.request !== null) c.request = r.request;
        if (r.state !== null) c.taskState = r.state;
        return c;
      });
  }

  insert(c: Checkpoint): void {
    this.db
      .insert(checkpoints)
      .values({
        id: c.id,
        taskId: c.taskId,
        projectId: c.projectId,
        headBefore: c.headBefore ?? null,
        baseSnapshotRef: c.baseSha ? `${c.baseSnapshotRef}@${c.baseSha}` : c.baseSnapshotRef,
        resultCommit: c.resultCommit ?? null,
        createdAt: c.createdAt,
      })
      .run();
  }

  setResult(taskId: string, resultCommit: string | undefined): void {
    this.db
      .update(checkpoints)
      .set({ resultCommit: resultCommit ?? null })
      .where(eq(checkpoints.taskId, taskId))
      .run();
  }
}

function toCheckpoint(row: typeof checkpoints.$inferSelect): Checkpoint {
  const [ref, sha] = row.baseSnapshotRef.split("@");
  const c: Checkpoint = {
    id: row.id,
    taskId: row.taskId,
    projectId: row.projectId,
    baseSnapshotRef: ref ?? row.baseSnapshotRef,
    createdAt: row.createdAt,
  };
  if (sha) c.baseSha = sha;
  if (row.headBefore !== null) c.headBefore = row.headBefore;
  if (row.resultCommit !== null) c.resultCommit = row.resultCommit;
  return c;
}
