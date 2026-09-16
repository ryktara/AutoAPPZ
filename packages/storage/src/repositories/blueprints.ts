import { and, asc, desc, eq } from "drizzle-orm";
import { blueprint as contracts } from "@autoappz/contracts";
import type { PlatformDb } from "../database.ts";
import { acceptanceCriteria, blueprints, requirements } from "../schema.ts";

type Blueprint = contracts.Blueprint;
type Requirement = contracts.Requirement;
type AcceptanceCriterion = contracts.AcceptanceCriterion;

export class BlueprintsRepository {
  constructor(private readonly db: PlatformDb) {}

  latest(projectId: string): Blueprint | undefined {
    const row = this.db
      .select()
      .from(blueprints)
      .where(eq(blueprints.projectId, projectId))
      .orderBy(desc(blueprints.version))
      .get();
    return row ? toBlueprint(row) : undefined;
  }

  get(projectId: string, version: number): Blueprint | undefined {
    const row = this.db
      .select()
      .from(blueprints)
      .where(and(eq(blueprints.projectId, projectId), eq(blueprints.version, version)))
      .get();
    return row ? toBlueprint(row) : undefined;
  }

  insert(b: Blueprint): void {
    this.db
      .insert(blueprints)
      .values({
        id: b.id,
        projectId: b.projectId,
        version: b.version,
        document: JSON.stringify(b.document),
        approvedAt: b.approvedAt ?? null,
        derivedFromTaskId: b.derivedFromTaskId ?? null,
      })
      .run();
  }

  setApproved(id: string, approvedAt: number): void {
    this.db.update(blueprints).set({ approvedAt }).where(eq(blueprints.id, id)).run();
  }
}

function toBlueprint(row: typeof blueprints.$inferSelect): Blueprint {
  const b: Blueprint = {
    id: row.id,
    projectId: row.projectId,
    version: row.version,
    document: contracts.BlueprintDocumentSchema.parse(JSON.parse(row.document)),
  };
  if (row.approvedAt !== null) b.approvedAt = row.approvedAt;
  if (row.derivedFromTaskId !== null) b.derivedFromTaskId = row.derivedFromTaskId;
  return b;
}

export class RequirementsRepository {
  constructor(private readonly db: PlatformDb) {}

  list(projectId: string): { requirements: Requirement[]; criteria: AcceptanceCriterion[] } {
    const reqs = this.db
      .select()
      .from(requirements)
      .where(eq(requirements.projectId, projectId))
      .orderBy(asc(requirements.id))
      .all()
      .map(toRequirement);
    const ids = new Set(reqs.map((r) => r.id));
    const crits = this.db
      .select()
      .from(acceptanceCriteria)
      .orderBy(asc(acceptanceCriteria.id))
      .all()
      .filter((c) => ids.has(c.requirementId))
      .map(toCriterion);
    return { requirements: reqs, criteria: crits };
  }

  /** Replaces the project's requirement set atomically. Cascade removes criteria of dropped requirements. */
  replace(projectId: string, reqs: readonly Requirement[], crits: readonly AcceptanceCriterion[]): void {
    this.db.transaction((tx) => {
      tx.delete(requirements).where(eq(requirements.projectId, projectId)).run();
      for (const r of reqs) {
        tx.insert(requirements)
          .values({
            id: r.id,
            projectId,
            blueprintItemRef: r.blueprintItemRef ?? null,
            title: r.title,
            status: r.status,
          })
          .run();
      }
      for (const c of crits) {
        tx.insert(acceptanceCriteria)
          .values({
            id: c.id,
            requirementId: c.requirementId,
            text: c.text,
            status: c.status,
            evidence: c.evidence ? JSON.stringify(c.evidence) : null,
          })
          .run();
      }
    });
  }
}

function toRequirement(row: typeof requirements.$inferSelect): Requirement {
  const r: Requirement = {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    status: row.status as Requirement["status"],
  };
  if (row.blueprintItemRef !== null) r.blueprintItemRef = row.blueprintItemRef;
  return r;
}

function toCriterion(row: typeof acceptanceCriteria.$inferSelect): AcceptanceCriterion {
  const c: AcceptanceCriterion = {
    id: row.id,
    requirementId: row.requirementId,
    text: row.text,
    status: row.status as AcceptanceCriterion["status"],
  };
  if (row.evidence !== null) c.evidence = JSON.parse(row.evidence) as Record<string, unknown>;
  return c;
}
