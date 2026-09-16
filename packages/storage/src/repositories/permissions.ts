import { asc, eq, isNull, or } from "drizzle-orm";
import type { permissions as contracts } from "@autoappz/contracts";
import type { PlatformDb } from "../database.ts";
import { permissions, toolCalls } from "../schema.ts";

type Policy = contracts.Policy;
type Audit = contracts.ToolCallAudit;

/** Standing `project`-lifetime policies. Session/once policies live in memory (engine). */
export class PermissionsRepository {
  constructor(private readonly db: PlatformDb) {}

  list(projectId?: string): Policy[] {
    const q = this.db.select().from(permissions);
    const rows =
      projectId === undefined
        ? q.orderBy(asc(permissions.createdAt)).all()
        : q
            .where(or(eq(permissions.projectId, projectId), isNull(permissions.projectId)))
            .orderBy(asc(permissions.createdAt))
            .all();
    return rows.map(toPolicy);
  }

  insert(p: Policy): void {
    this.db
      .insert(permissions)
      .values({
        id: p.id,
        projectId: p.projectId ?? null,
        capability: p.capability,
        scopePattern: p.scopePattern,
        decision: p.decision,
        lifetime: p.lifetime,
        createdAt: p.createdAt,
        expiresAt: p.expiresAt ?? null,
      })
      .run();
  }

  delete(id: string): boolean {
    return this.db.delete(permissions).where(eq(permissions.id, id)).run().changes > 0;
  }
}

function toPolicy(row: typeof permissions.$inferSelect): Policy {
  const p: Policy = {
    id: row.id,
    capability: row.capability as Policy["capability"],
    scopePattern: row.scopePattern,
    decision: row.decision as Policy["decision"],
    lifetime: row.lifetime as Policy["lifetime"],
    createdAt: row.createdAt,
  };
  if (row.projectId !== null) p.projectId = row.projectId;
  if (row.expiresAt !== null) p.expiresAt = row.expiresAt;
  return p;
}

/** Append-only audit of tool calls. */
export class ToolCallsRepository {
  constructor(private readonly db: PlatformDb) {}

  insert(a: Audit): void {
    this.db
      .insert(toolCalls)
      .values({
        id: a.id,
        taskId: a.taskId,
        agentRunId: a.agentRunId ?? null,
        toolId: a.toolId,
        capability: a.capability,
        scope: JSON.stringify(a.scope),
        decision: a.decision,
        decisionSource: a.decisionSource,
        inputRedacted: JSON.stringify(a.inputRedacted ?? null),
        resultSummary: `${a.ok ? "ok" : "error"}:${a.resultSummary}`,
        durationMs: a.durationMs,
        at: a.at,
      })
      .run();
  }

  list(taskId: string): Audit[] {
    return this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.taskId, taskId))
      .orderBy(asc(toolCalls.at), asc(toolCalls.id))
      .all()
      .map((r) => {
        const summary = r.resultSummary ?? "error:";
        const ok = summary.startsWith("ok:");
        const a: Audit = {
          id: r.id,
          taskId: r.taskId,
          toolId: r.toolId,
          capability: r.capability as Audit["capability"],
          scope: r.scope ? (JSON.parse(r.scope) as string) : "",
          decision: r.decision as Audit["decision"],
          decisionSource: r.decisionSource as Audit["decisionSource"],
          inputRedacted: r.inputRedacted ? (JSON.parse(r.inputRedacted) as unknown) : undefined,
          ok,
          resultSummary: summary.replace(/^(ok|error):/, ""),
          durationMs: r.durationMs ?? 0,
          at: r.at,
        };
        if (r.agentRunId !== null) a.agentRunId = r.agentRunId;
        return a;
      });
  }
}
