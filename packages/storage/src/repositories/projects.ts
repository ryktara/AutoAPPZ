import { and, desc, eq, isNull } from "drizzle-orm";
import type { project as contracts } from "@autoappz/contracts";
import type { PlatformDb } from "../database.ts";
import { projects } from "../schema.ts";

type Project = contracts.Project;

export class ProjectsRepository {
  constructor(private readonly db: PlatformDb) {}

  list(includeArchived = false): Project[] {
    const q = this.db.select().from(projects);
    const rows = includeArchived
      ? q.orderBy(desc(projects.lastOpenedAt)).all()
      : q.where(isNull(projects.archivedAt)).orderBy(desc(projects.lastOpenedAt)).all();
    return rows.map(toProject);
  }

  get(id: string): Project | undefined {
    const row = this.db.select().from(projects).where(eq(projects.id, id)).get();
    return row ? toProject(row) : undefined;
  }

  findByPath(path: string): Project | undefined {
    const row = this.db
      .select()
      .from(projects)
      .where(and(eq(projects.path, path), isNull(projects.archivedAt)))
      .get();
    return row ? toProject(row) : undefined;
  }

  insert(p: Project): void {
    this.db
      .insert(projects)
      .values({
        id: p.id,
        name: p.name,
        path: p.path,
        origin: p.origin,
        templateId: p.templateId ?? null,
        runtimeProfile: p.runtimeProfile,
        createdAt: p.createdAt,
        lastOpenedAt: p.lastOpenedAt,
        archivedAt: p.archivedAt ?? null,
      })
      .run();
  }

  update(p: Project): void {
    this.db
      .update(projects)
      .set({
        name: p.name,
        path: p.path,
        runtimeProfile: p.runtimeProfile,
        lastOpenedAt: p.lastOpenedAt,
        archivedAt: p.archivedAt ?? null,
      })
      .where(eq(projects.id, p.id))
      .run();
  }

  delete(id: string): boolean {
    return this.db.delete(projects).where(eq(projects.id, id)).run().changes > 0;
  }
}

function toProject(row: typeof projects.$inferSelect): Project {
  const p: Project = {
    id: row.id,
    name: row.name,
    path: row.path,
    origin: row.origin as Project["origin"],
    runtimeProfile: (row.runtimeProfile ?? "host") as Project["runtimeProfile"],
    createdAt: row.createdAt,
    lastOpenedAt: row.lastOpenedAt,
  };
  if (row.templateId !== null) p.templateId = row.templateId;
  if (row.archivedAt !== null) p.archivedAt = row.archivedAt;
  return p;
}
