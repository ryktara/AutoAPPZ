import { asc, desc, eq } from "drizzle-orm";
import { deployment as contracts } from "@autoappz/contracts";
import type { PlatformDb } from "../database.ts";
import { deploymentTargets, deployments } from "../schema.ts";

type DeploymentTarget = contracts.DeploymentTarget;
type DeploymentRecord = contracts.DeploymentRecord;

export class DeploymentTargetsRepository {
  constructor(private readonly db: PlatformDb) {}

  list(projectId: string): DeploymentTarget[] {
    return this.db
      .select()
      .from(deploymentTargets)
      .where(eq(deploymentTargets.projectId, projectId))
      .orderBy(asc(deploymentTargets.name))
      .all()
      .map(toTarget);
  }

  get(id: string): DeploymentTarget | undefined {
    const row = this.db.select().from(deploymentTargets).where(eq(deploymentTargets.id, id)).get();
    return row ? toTarget(row) : undefined;
  }

  upsert(t: DeploymentTarget): void {
    const values = {
      id: t.id,
      projectId: t.projectId,
      adapterId: t.adapterId,
      name: t.name,
      config: JSON.stringify(t.config),
      secretId: t.secretId ?? null,
      envSecrets: JSON.stringify(t.envSecrets),
      updatedAt: t.updatedAt,
    };
    this.db
      .insert(deploymentTargets)
      .values(values)
      .onConflictDoUpdate({ target: deploymentTargets.id, set: values })
      .run();
  }

  delete(id: string): boolean {
    return this.db.delete(deploymentTargets).where(eq(deploymentTargets.id, id)).run().changes > 0;
  }
}

export class DeploymentsRepository {
  constructor(private readonly db: PlatformDb) {}

  insert(r: DeploymentRecord): void {
    this.db
      .insert(deployments)
      .values({
        id: r.id,
        targetId: r.targetId,
        projectId: r.projectId,
        adapterId: r.adapterId,
        status: r.status,
        url: r.url ?? null,
        providerRef: r.providerRef ?? null,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt ?? null,
        error: r.error ?? null,
        log: "",
      })
      .run();
  }

  finish(
    id: string,
    patch: {
      status: DeploymentRecord["status"];
      url?: string | undefined;
      providerRef?: string | undefined;
      error?: string | undefined;
      finishedAt: number;
      log: string;
    },
  ): void {
    this.db
      .update(deployments)
      .set({
        status: patch.status,
        url: patch.url ?? null,
        providerRef: patch.providerRef ?? null,
        error: patch.error ?? null,
        finishedAt: patch.finishedAt,
        log: patch.log,
      })
      .where(eq(deployments.id, id))
      .run();
  }

  get(id: string): (DeploymentRecord & { log: string }) | undefined {
    const row = this.db.select().from(deployments).where(eq(deployments.id, id)).get();
    return row ? { ...toRecord(row), log: row.log } : undefined;
  }

  list(projectId: string, limit = 20): DeploymentRecord[] {
    return this.db
      .select()
      .from(deployments)
      .where(eq(deployments.projectId, projectId))
      .orderBy(desc(deployments.startedAt))
      .limit(limit)
      .all()
      .map(toRecord);
  }
}

function toTarget(row: typeof deploymentTargets.$inferSelect): DeploymentTarget {
  const t: DeploymentTarget = {
    id: row.id,
    projectId: row.projectId,
    adapterId: contracts.DeploymentAdapterIdSchema.parse(row.adapterId),
    name: row.name,
    config: contracts.DeploymentTargetSchema.shape.config.parse(JSON.parse(row.config)),
    envSecrets: contracts.DeploymentTargetSchema.shape.envSecrets.parse(JSON.parse(row.envSecrets)),
    updatedAt: row.updatedAt,
  };
  if (row.secretId !== null) t.secretId = row.secretId;
  return t;
}

function toRecord(row: typeof deployments.$inferSelect): DeploymentRecord {
  const r: DeploymentRecord = {
    id: row.id,
    targetId: row.targetId,
    projectId: row.projectId,
    adapterId: contracts.DeploymentAdapterIdSchema.parse(row.adapterId),
    status: contracts.DeploymentStatusSchema.parse(row.status),
    startedAt: row.startedAt,
  };
  if (row.url !== null) r.url = row.url;
  if (row.providerRef !== null) r.providerRef = row.providerRef;
  if (row.finishedAt !== null) r.finishedAt = row.finishedAt;
  if (row.error !== null) r.error = row.error;
  return r;
}
