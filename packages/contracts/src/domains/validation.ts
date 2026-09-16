import { z } from "zod";
import { defineCommand, defineEvent, defineQuery } from "../definitions.ts";
import { ProjectIdSchema, TaskIdSchema } from "../common.ts";

export const ValidationDiagnosticSchema = z.object({
  validator: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  code: z.string().optional(),
  message: z.string(),
  /** Project-relative path. */
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
});
export type ValidationDiagnostic = z.infer<typeof ValidationDiagnosticSchema>;

export const ValidationResultSchema = z.object({
  validator: z.string(),
  status: z.enum(["passed", "failed", "skipped", "error"]),
  diagnostics: z.array(ValidationDiagnosticSchema),
  durationMs: z.number().nonnegative(),
  truncated: z.boolean(),
  note: z.string().optional(),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

export const ValidationReportSchema = z.object({
  attempt: z.number().int().nonnegative(),
  ok: z.boolean(),
  results: z.array(ValidationResultSchema),
  diagnostics: z.array(ValidationDiagnosticSchema),
  durationMs: z.number().nonnegative(),
  startedAt: z.number().int().nonnegative(),
});
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

/** Reports recorded for a task (one per validation attempt, oldest first). */
export const taskValidation = defineQuery({
  name: "task.validation",
  input: z.object({ taskId: TaskIdSchema }),
  output: z.array(ValidationReportSchema),
  scope: "validation",
});

/** On-demand run over the project's uncommitted changes (or everything when clean); result kept per project. */
export const validationRun = defineCommand({
  name: "validation.run",
  input: z.object({ projectId: ProjectIdSchema, tier: z.number().int().min(0).max(3).default(2) }),
  output: ValidationReportSchema,
  invalidates: ["validation"],
});

export const validationLatest = defineQuery({
  name: "validation.latest",
  input: z.object({ projectId: ProjectIdSchema }),
  output: z.object({ report: ValidationReportSchema.optional(), running: z.boolean() }),
  scope: "validation",
});

export const validationChanged = defineEvent({
  name: "validation.changed",
  payload: z.object({ projectId: ProjectIdSchema }),
});
