import { and, eq, sql } from "drizzle-orm";
import type { providers as contracts } from "@autoappz/contracts";
import type { PlatformDb } from "../database.ts";
import { tasks, usageRecords } from "../schema.ts";

export interface UsageRecordRow {
  id: string;
  taskId: string | undefined;
  providerId: contracts.ProviderId;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  at: number;
}

/** Append-only usage ledger. Summaries aggregate per model; project scoping goes through tasks. */
export class UsageRecordsRepository {
  constructor(private readonly db: PlatformDb) {}

  insert(row: UsageRecordRow): void {
    this.db
      .insert(usageRecords)
      .values({
        id: row.id,
        taskId: row.taskId ?? null,
        provider: row.providerId,
        model: row.modelId,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        estimatedCost: row.estimatedCostUsd,
        at: row.at,
      })
      .run();
  }

  summary(
    filter: { projectId?: string | undefined; taskId?: string | undefined } = {},
  ): contracts.UsageSummary {
    const conditions = [];
    if (filter.taskId !== undefined) conditions.push(eq(usageRecords.taskId, filter.taskId));
    if (filter.projectId !== undefined) conditions.push(eq(tasks.projectId, filter.projectId));
    const rows = this.db
      .select({
        provider: usageRecords.provider,
        model: usageRecords.model,
        calls: sql<number>`count(*)`,
        inputTokens: sql<number>`coalesce(sum(${usageRecords.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${usageRecords.outputTokens}), 0)`,
        cost: sql<number>`coalesce(sum(${usageRecords.estimatedCost}), 0)`,
      })
      .from(usageRecords)
      .leftJoin(tasks, eq(tasks.id, usageRecords.taskId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(usageRecords.provider, usageRecords.model)
      .all();
    const byModel = rows.map((r) => ({
      providerId: r.provider as contracts.ProviderId,
      modelId: r.model,
      calls: r.calls,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      estimatedCostUsd: round(r.cost),
    }));
    return {
      calls: byModel.reduce((a, b) => a + b.calls, 0),
      inputTokens: byModel.reduce((a, b) => a + b.inputTokens, 0),
      outputTokens: byModel.reduce((a, b) => a + b.outputTokens, 0),
      estimatedCostUsd: round(byModel.reduce((a, b) => a + b.estimatedCostUsd, 0)),
      byModel,
    };
  }
}

const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
