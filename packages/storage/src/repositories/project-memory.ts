import { and, asc, eq, isNull } from "drizzle-orm";
import type { memory as contracts } from "@autoappz/contracts";
import type { PlatformDb } from "../database.ts";
import { projectMemory } from "../schema.ts";

type Item = contracts.ProjectMemoryItem;

export class ProjectMemoryRepository {
  constructor(private readonly db: PlatformDb) {}

  list(projectId: string, includeSuperseded = false): Item[] {
    const q = this.db.select().from(projectMemory);
    const rows = includeSuperseded
      ? q.where(eq(projectMemory.projectId, projectId)).orderBy(asc(projectMemory.createdAt)).all()
      : q
          .where(and(eq(projectMemory.projectId, projectId), isNull(projectMemory.supersededBy)))
          .orderBy(asc(projectMemory.createdAt))
          .all();
    return rows.map(toItem);
  }

  get(id: string): Item | undefined {
    const row = this.db.select().from(projectMemory).where(eq(projectMemory.id, id)).get();
    return row ? toItem(row) : undefined;
  }

  insert(item: Item): void {
    this.db
      .insert(projectMemory)
      .values({
        id: item.id,
        projectId: item.projectId,
        category: item.category,
        statement: item.statement,
        provenanceTaskId: item.provenanceTaskId ?? null,
        confidence: item.confidence,
        createdAt: item.createdAt,
        supersededBy: item.supersededBy ?? null,
      })
      .run();
  }

  markSuperseded(id: string, by: string): void {
    this.db.update(projectMemory).set({ supersededBy: by }).where(eq(projectMemory.id, id)).run();
  }

  delete(id: string): boolean {
    return this.db.delete(projectMemory).where(eq(projectMemory.id, id)).run().changes > 0;
  }
}

function toItem(row: typeof projectMemory.$inferSelect): Item {
  const item: Item = {
    id: row.id,
    projectId: row.projectId,
    category: row.category as Item["category"],
    statement: row.statement,
    confidence: row.confidence,
    createdAt: row.createdAt,
  };
  if (row.provenanceTaskId !== null) item.provenanceTaskId = row.provenanceTaskId;
  if (row.supersededBy !== null) item.supersededBy = row.supersededBy;
  return item;
}
