import { asc, eq } from "drizzle-orm";
import { integrations as contracts } from "@autoappz/contracts";
import type { PlatformDb } from "../database.ts";
import { integrations } from "../schema.ts";

type Integration = contracts.Integration;

export class IntegrationsRepository {
  constructor(private readonly db: PlatformDb) {}

  list(projectId: string): Integration[] {
    return this.db
      .select()
      .from(integrations)
      .where(eq(integrations.projectId, projectId))
      .orderBy(asc(integrations.name))
      .all()
      .map(toIntegration);
  }

  get(id: string): Integration | undefined {
    const row = this.db.select().from(integrations).where(eq(integrations.id, id)).get();
    return row ? toIntegration(row) : undefined;
  }

  upsert(i: Integration): void {
    this.db
      .insert(integrations)
      .values({
        id: i.id,
        projectId: i.projectId,
        kind: i.kind,
        adapterId: i.adapterId,
        name: i.name,
        config: JSON.stringify(i.config),
        secretId: i.secretId ?? null,
        status: i.status,
        statusMessage: i.statusMessage ?? null,
        updatedAt: i.updatedAt,
      })
      .onConflictDoUpdate({
        target: integrations.id,
        set: {
          name: i.name,
          adapterId: i.adapterId,
          config: JSON.stringify(i.config),
          secretId: i.secretId ?? null,
          status: i.status,
          statusMessage: i.statusMessage ?? null,
          updatedAt: i.updatedAt,
        },
      })
      .run();
  }

  setStatus(id: string, status: Integration["status"], message: string | undefined, at: number): void {
    this.db
      .update(integrations)
      .set({ status, statusMessage: message ?? null, updatedAt: at })
      .where(eq(integrations.id, id))
      .run();
  }

  delete(id: string): boolean {
    return this.db.delete(integrations).where(eq(integrations.id, id)).run().changes > 0;
  }
}

function toIntegration(row: typeof integrations.$inferSelect): Integration {
  const config = contracts.IntegrationSchema.shape.config.parse(JSON.parse(row.config));
  const i: Integration = {
    id: row.id,
    projectId: row.projectId,
    kind: "database",
    adapterId: contracts.DatabaseAdapterIdSchema.parse(row.adapterId),
    name: row.name,
    config,
    status: contracts.IntegrationStatusSchema.parse(row.status),
    updatedAt: row.updatedAt,
  };
  if (row.secretId !== null) i.secretId = row.secretId;
  if (row.statusMessage !== null) i.statusMessage = row.statusMessage;
  return i;
}
