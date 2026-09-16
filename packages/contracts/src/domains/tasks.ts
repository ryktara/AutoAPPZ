import { z } from "zod";
import { defineCommand, defineEvent, defineQuery, defineStream } from "../definitions.ts";
import { ProjectIdSchema, SessionIdSchema, TaskIdSchema } from "../common.ts";
import { ComplexitySchema, ModelRefSchema } from "./providers.ts";

/** Task lifecycle vocabulary (docs/design/AGENT-ARCHITECTURE.md). Kept in contracts so the UI can render it. */
export const TASK_STATES = [
  "UNDERSTAND",
  "EXPLORE",
  "PLAN",
  "AWAIT_APPROVAL",
  "EXECUTE",
  "VALIDATE",
  "DIAGNOSE",
  "REPAIR",
  "REVIEW",
  "CHECKPOINT",
  "COMPLETE",
  "CANCELLED",
  "NEEDS_USER",
  "INTERRUPTED",
] as const;
export const TaskStateSchema = z.enum(TASK_STATES);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const TERMINAL_TASK_STATES: ReadonlySet<TaskState> = new Set(["COMPLETE", "CANCELLED"]);
export function isTerminalTaskState(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.has(state);
}

/** `ask` tasks are read-only conversations; `build` tasks (M5+) may change files. */
export const TaskModeSchema = z.enum(["ask", "build"]);
export type TaskMode = z.infer<typeof TaskModeSchema>;

export const TaskCostSchema = z.object({
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type TaskCost = z.infer<typeof TaskCostSchema>;

export const TaskSchema = z.object({
  id: TaskIdSchema,
  projectId: ProjectIdSchema,
  sessionId: SessionIdSchema,
  mode: TaskModeSchema,
  request: z.string().min(1),
  complexity: ComplexitySchema,
  state: TaskStateSchema,
  model: ModelRefSchema.optional(),
  error: z.string().optional(),
  cost: TaskCostSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  terminalAt: z.number().int().nonnegative().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export const SessionSchema = z.object({
  id: SessionIdSchema,
  projectId: ProjectIdSchema,
  title: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  lastActiveAt: z.number().int().nonnegative(),
});
export type Session = z.infer<typeof SessionSchema>;

export const MessageRoleSchema = z.enum(["user", "assistant", "system"]);

export const MessageSchema = z.object({
  id: z.string().min(1),
  sessionId: SessionIdSchema,
  role: MessageRoleSchema,
  content: z.string(),
  taskId: TaskIdSchema.optional(),
  /** True when the task was cancelled or failed mid-stream and this is what arrived so far. */
  partial: z.boolean().default(false),
  createdAt: z.number().int().nonnegative(),
});
export type Message = z.infer<typeof MessageSchema>;

export const taskSubmit = defineCommand({
  name: "task.submit",
  input: z.object({
    projectId: ProjectIdSchema,
    /** Omit to continue the project's most recent session (or start one). */
    sessionId: SessionIdSchema.optional(),
    request: z.string().trim().min(1).max(20_000),
    mode: TaskModeSchema.default("ask"),
  }),
  output: z.object({ taskId: TaskIdSchema, sessionId: SessionIdSchema }),
  invalidates: ["tasks", "sessions", "messages"],
});

export const taskCancel = defineCommand({
  name: "task.cancel",
  input: z.object({ taskId: TaskIdSchema }),
  output: z.void(),
  invalidates: ["tasks"],
});

export const taskGet = defineQuery({
  name: "task.get",
  input: z.object({ taskId: TaskIdSchema }),
  output: TaskSchema,
  scope: "tasks",
});

export const taskList = defineQuery({
  name: "task.list",
  input: z.object({ projectId: ProjectIdSchema, limit: z.number().int().min(1).max(200).default(50) }),
  output: z.array(TaskSchema),
  scope: "tasks",
});

/** Live view of one task. Late subscribers receive everything emitted so far, then live chunks. */
export const TaskStreamChunkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("state"), state: TaskStateSchema }),
  z.object({ kind: z.literal("model"), model: ModelRefSchema, reason: z.string() }),
  z.object({ kind: z.literal("text"), delta: z.string() }),
  z.object({ kind: z.literal("reasoning"), delta: z.string() }),
  z.object({ kind: z.literal("usage"), cost: TaskCostSchema }),
  z.object({ kind: z.literal("error"), message: z.string(), retryable: z.boolean() }),
  z.object({ kind: z.literal("done"), state: TaskStateSchema }),
]);
export type TaskStreamChunk = z.infer<typeof TaskStreamChunkSchema>;

export const taskStream = defineStream({
  name: "task.stream",
  input: z.object({ taskId: TaskIdSchema }),
  chunk: TaskStreamChunkSchema,
});

export const sessionList = defineQuery({
  name: "session.list",
  input: z.object({ projectId: ProjectIdSchema }),
  output: z.array(SessionSchema),
  scope: "sessions",
});

export const sessionMessages = defineQuery({
  name: "session.messages",
  input: z.object({ sessionId: SessionIdSchema }),
  output: z.array(MessageSchema),
  scope: "messages",
});

export const taskChanged = defineEvent({
  name: "task.changed",
  payload: z.object({
    taskId: TaskIdSchema,
    projectId: ProjectIdSchema,
    sessionId: SessionIdSchema,
    state: TaskStateSchema,
  }),
});
