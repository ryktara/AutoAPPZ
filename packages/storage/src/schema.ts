import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Platform database schema (docs/architecture/DATABASE.md). Column names are explicit snake_case so the
 * hand-written migrations in ./migrations and this schema can be cross-checked by test.
 * Rule: no secret values in any column.
 */

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
  updatedAt: integer("updated_at").notNull(),
});

export const secretRefs = sqliteTable("secret_refs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  provider: text("provider"),
  label: text("label").notNull(),
  lastFour: text("last_four"),
  createdAt: integer("created_at").notNull(),
  rotatedAt: integer("rotated_at"),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  origin: text("origin").notNull(), // created | imported | copied
  templateId: text("template_id"),
  runtimeProfile: text("runtime_profile"),
  createdAt: integer("created_at").notNull(),
  lastOpenedAt: integer("last_opened_at").notNull(),
  archivedAt: integer("archived_at"),
});

export const integrations = sqliteTable(
  "integrations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // database | deployment | vcs | mcp
    adapterId: text("adapter_id").notNull(),
    config: text("config").notNull(), // JSON, secret-free
    status: text("status").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("integrations_project_idx").on(t.projectId)],
);

export const blueprints = sqliteTable(
  "blueprints",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    document: text("document").notNull(), // JSON
    approvedAt: integer("approved_at"),
    derivedFromTaskId: text("derived_from_task_id"),
  },
  (t) => [index("blueprints_project_idx").on(t.projectId)],
);

export const requirements = sqliteTable(
  "requirements",
  {
    id: text("id").primaryKey(), // REQ-nnn scoped by project
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    blueprintItemRef: text("blueprint_item_ref"),
    title: text("title").notNull(),
    status: text("status").notNull(),
  },
  (t) => [index("requirements_project_idx").on(t.projectId)],
);

export const acceptanceCriteria = sqliteTable(
  "acceptance_criteria",
  {
    id: text("id").primaryKey(),
    requirementId: text("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    status: text("status").notNull(),
    evidence: text("evidence"), // JSON
  },
  (t) => [index("acceptance_criteria_requirement_idx").on(t.requirementId)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: integer("created_at").notNull(),
    lastActiveAt: integer("last_active_at").notNull(),
  },
  (t) => [index("sessions_project_idx").on(t.projectId)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    taskId: text("task_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("messages_session_idx").on(t.sessionId)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    request: text("request").notNull(),
    complexity: text("complexity").notNull(),
    state: text("state").notNull(),
    plan: text("plan"), // JSON
    checkpointId: text("checkpoint_id"),
    cost: text("cost"), // JSON
    model: text("model"), // JSON ModelRef (0002)
    error: text("error"), // (0002)
    mode: text("mode").notNull().default("ask"), // (0002)
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    terminalAt: integer("terminal_at"),
  },
  (t) => [index("tasks_project_idx").on(t.projectId), index("tasks_session_idx").on(t.sessionId)],
);

export const taskEvents = sqliteTable(
  "task_events",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    event: text("event").notNull(),
    payload: text("payload"), // JSON
    at: integer("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.seq] })],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    tokens: text("tokens"), // JSON {input, output, cached}
    cost: real("cost"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    status: text("status").notNull(),
  },
  (t) => [index("agent_runs_task_idx").on(t.taskId)],
);

export const toolCalls = sqliteTable(
  "tool_calls",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    agentRunId: text("agent_run_id"),
    toolId: text("tool_id").notNull(),
    capability: text("capability").notNull(),
    scope: text("scope"), // JSON
    decision: text("decision").notNull(),
    decisionSource: text("decision_source").notNull(),
    inputRedacted: text("input_redacted"), // JSON
    resultSummary: text("result_summary"),
    durationMs: integer("duration_ms"),
    at: integer("at").notNull(),
  },
  (t) => [index("tool_calls_task_idx").on(t.taskId)],
);

export const checkpoints = sqliteTable(
  "checkpoints",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    headBefore: text("head_before"),
    baseSnapshotRef: text("base_snapshot_ref").notNull(),
    resultCommit: text("result_commit"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("checkpoints_project_idx").on(t.projectId)],
);

export const projectMemory = sqliteTable(
  "project_memory",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    statement: text("statement").notNull(),
    provenanceTaskId: text("provenance_task_id"),
    confidence: real("confidence").notNull(),
    createdAt: integer("created_at").notNull(),
    supersededBy: text("superseded_by"),
  },
  (t) => [index("project_memory_project_idx").on(t.projectId)],
);

export const usageRecords = sqliteTable(
  "usage_records",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    estimatedCost: real("estimated_cost"),
    at: integer("at").notNull(),
  },
  (t) => [index("usage_records_task_idx").on(t.taskId)],
);

export const permissions = sqliteTable(
  "permissions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    capability: text("capability").notNull(),
    scopePattern: text("scope_pattern").notNull(),
    decision: text("decision").notNull(),
    lifetime: text("lifetime").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at"),
  },
  (t) => [index("permissions_project_idx").on(t.projectId)],
);

export const indexStatus = sqliteTable("index_status", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  state: text("state").notNull(),
  files: integer("files").notNull().default(0),
  indexed: integer("indexed").notNull().default(0),
  lastFullAt: integer("last_full_at"),
  lastIncrementalAt: integer("last_incremental_at"),
  error: text("error"),
});

export const schema = {
  settings,
  secretRefs,
  projects,
  integrations,
  blueprints,
  requirements,
  acceptanceCriteria,
  sessions,
  messages,
  tasks,
  taskEvents,
  agentRuns,
  toolCalls,
  checkpoints,
  projectMemory,
  usageRecords,
  permissions,
  indexStatus,
};
export type Schema = typeof schema;
