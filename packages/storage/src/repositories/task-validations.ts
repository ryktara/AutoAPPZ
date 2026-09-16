import { asc, eq } from "drizzle-orm";
import { validation as contracts } from "@autoappz/contracts";
import type { PlatformDb } from "../database.ts";
import { taskValidations } from "../schema.ts";

/** One row per validation attempt of a task; the report is stored as validated JSON. */
export class TaskValidationsRepository {
  constructor(private readonly db: PlatformDb) {}

  list(taskId: string): contracts.ValidationReport[] {
    return this.db
      .select()
      .from(taskValidations)
      .where(eq(taskValidations.taskId, taskId))
      .orderBy(asc(taskValidations.attempt))
      .all()
      .map((r) => contracts.ValidationReportSchema.parse(JSON.parse(r.report)));
  }

  insert(id: string, taskId: string, report: contracts.ValidationReport, at: number): void {
    this.db
      .insert(taskValidations)
      .values({ id, taskId, attempt: report.attempt, report: JSON.stringify(report), createdAt: at })
      .run();
  }
}
