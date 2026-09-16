import { z } from "zod";
import { defineCommand, defineEvent, defineQuery, defineStream } from "../definitions.ts";
import { ProjectIdSchema } from "../common.ts";

export const PhaseSchema = z.enum(["install", "serve", "build", "test", "script"]);
export type Phase = z.infer<typeof PhaseSchema>;

export const ProcessStateSchema = z.enum([
  "STOPPED",
  "STARTING",
  "RUNNING",
  "DEGRADED",
  "CRASHED",
  "RESTARTING",
  "STOPPING",
]);
export type ProcessState = z.infer<typeof ProcessStateSchema>;

export const ExitInfoSchema = z.object({
  code: z.number().int().nullable(),
  signal: z.string().nullable(),
  classified: z.enum(["clean", "error", "killed", "timeout"]),
});
export type ExitInfo = z.infer<typeof ExitInfoSchema>;

export const RuntimeProcessSchema = z.object({
  projectId: ProjectIdSchema,
  phase: PhaseSchema,
  state: ProcessStateSchema,
  invocationId: z.string().optional(),
  pid: z.number().int().optional(),
  port: z.number().int().optional(),
  /** Proxy URL the preview iframe loads (serve phase only). */
  previewUrl: z.string().optional(),
  startedAt: z.number().int().optional(),
  exit: ExitInfoSchema.optional(),
  health: z.object({ lastOkAt: z.number().int().optional(), failures: z.number().int() }).optional(),
  restarts: z.number().int().default(0),
  lastError: z.string().optional(),
});
export type RuntimeProcess = z.infer<typeof RuntimeProcessSchema>;

export const PackageManagerSchema = z.enum(["pnpm", "npm", "yarn", "bun"]);
export type PackageManager = z.infer<typeof PackageManagerSchema>;

export const RuntimeStatusSchema = z.object({
  projectId: ProjectIdSchema,
  packageManager: PackageManagerSchema,
  processes: z.array(RuntimeProcessSchema),
  previewUrl: z.string().optional(),
});
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;

export const OutputLineSchema = z.object({
  seq: z.number().int().nonnegative(),
  phase: PhaseSchema,
  stream: z.enum(["stdout", "stderr", "system"]),
  text: z.string(),
  at: z.number().int().nonnegative(),
});
export type OutputLine = z.infer<typeof OutputLineSchema>;

export const RuntimeDiagnosticSchema = z.object({
  id: z.string().min(1),
  projectId: ProjectIdSchema,
  source: z.enum(["install", "vite", "tsc", "next", "runtime", "preview"]),
  phase: PhaseSchema.or(z.literal("preview")),
  severity: z.enum(["error", "warning"]),
  message: z.string().min(1).max(4000),
  file: z.string().optional(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
  code: z.string().optional(),
  stack: z.string().max(8000).optional(),
  at: z.number().int().nonnegative(),
});
export type RuntimeDiagnostic = z.infer<typeof RuntimeDiagnosticSchema>;

/** What the injected preview script reports (validated in the renderer, then forwarded). */
export const PreviewEventSchema = z.object({
  type: z.enum(["ready", "error", "unhandledrejection", "console", "navigation", "network", "blank"]),
  message: z.string().max(4000).optional(),
  stack: z.string().max(8000).optional(),
  level: z.enum(["error", "warn"]).optional(),
  url: z.string().max(2000).optional(),
  status: z.number().int().optional(),
  at: z.number().int().nonnegative(),
});
export type PreviewEvent = z.infer<typeof PreviewEventSchema>;

export const runtimeStatus = defineQuery({
  name: "runtime.status",
  input: z.object({ projectId: ProjectIdSchema }),
  output: RuntimeStatusSchema,
  scope: "runtime",
});

export const runtimeStart = defineCommand({
  name: "runtime.start",
  input: z.object({ projectId: ProjectIdSchema, phase: PhaseSchema }),
  output: RuntimeProcessSchema,
  invalidates: ["runtime"],
});

export const runtimeStop = defineCommand({
  name: "runtime.stop",
  input: z.object({ projectId: ProjectIdSchema, phase: PhaseSchema }),
  output: z.void(),
  invalidates: ["runtime"],
});

export const runtimeRestart = defineCommand({
  name: "runtime.restart",
  input: z.object({ projectId: ProjectIdSchema, phase: PhaseSchema }),
  output: RuntimeProcessSchema,
  invalidates: ["runtime"],
});

export const runtimeLogs = defineQuery({
  name: "runtime.logs",
  input: z.object({
    projectId: ProjectIdSchema,
    phase: PhaseSchema.optional(),
    limit: z.number().int().min(1).max(5000).default(500),
  }),
  output: z.array(OutputLineSchema),
  scope: "runtimeLogs",
});

export const runtimeDiagnostics = defineQuery({
  name: "runtime.diagnostics",
  input: z.object({ projectId: ProjectIdSchema, limit: z.number().int().min(1).max(500).default(100) }),
  output: z.array(RuntimeDiagnosticSchema),
  scope: "diagnostics",
});

export const runtimeClearDiagnostics = defineCommand({
  name: "runtime.clearDiagnostics",
  input: z.object({ projectId: ProjectIdSchema }),
  output: z.void(),
  invalidates: ["diagnostics"],
});

/** Renderer forwards validated preview-script messages here so the observer can record them. */
export const runtimeReportPreviewEvent = defineCommand({
  name: "runtime.reportPreviewEvent",
  input: z.object({ projectId: ProjectIdSchema, event: PreviewEventSchema }),
  output: z.void(),
});

export const runtimeOutput = defineStream({
  name: "runtime.output",
  input: z.object({ projectId: ProjectIdSchema, afterSeq: z.number().int().nonnegative().default(0) }),
  chunk: OutputLineSchema,
});

export const runtimeStateChanged = defineEvent({
  name: "runtime.stateChanged",
  payload: RuntimeProcessSchema,
});

export const runtimeDiagnostic = defineEvent({
  name: "runtime.diagnostic",
  payload: RuntimeDiagnosticSchema,
});
