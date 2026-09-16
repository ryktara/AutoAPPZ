import type { Migration } from "../migration.ts";

export const m0001Initial: Migration = {
  id: "0001_initial",
  up: [
    `CREATE TABLE settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE secret_refs (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      provider TEXT,
      label TEXT NOT NULL,
      last_four TEXT,
      created_at INTEGER NOT NULL,
      rotated_at INTEGER
    )`,
    `CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      origin TEXT NOT NULL,
      template_id TEXT,
      runtime_profile TEXT,
      created_at INTEGER NOT NULL,
      last_opened_at INTEGER NOT NULL,
      archived_at INTEGER
    )`,
    `CREATE TABLE integrations (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      adapter_id TEXT NOT NULL,
      config TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX integrations_project_idx ON integrations(project_id)`,
    `CREATE TABLE blueprints (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      document TEXT NOT NULL,
      approved_at INTEGER,
      derived_from_task_id TEXT
    )`,
    `CREATE INDEX blueprints_project_idx ON blueprints(project_id)`,
    `CREATE TABLE requirements (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      blueprint_item_ref TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL
    )`,
    `CREATE INDEX requirements_project_idx ON requirements(project_id)`,
    `CREATE TABLE acceptance_criteria (
      id TEXT PRIMARY KEY NOT NULL,
      requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      status TEXT NOT NULL,
      evidence TEXT
    )`,
    `CREATE INDEX acceptance_criteria_requirement_idx ON acceptance_criteria(requirement_id)`,
    `CREATE TABLE sessions (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL
    )`,
    `CREATE INDEX sessions_project_idx ON sessions(project_id)`,
    `CREATE TABLE messages (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      task_id TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX messages_session_idx ON messages(session_id)`,
    `CREATE TABLE tasks (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      request TEXT NOT NULL,
      complexity TEXT NOT NULL,
      state TEXT NOT NULL,
      plan TEXT,
      checkpoint_id TEXT,
      cost TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      terminal_at INTEGER
    )`,
    `CREATE INDEX tasks_project_idx ON tasks(project_id)`,
    `CREATE INDEX tasks_session_idx ON tasks(session_id)`,
    `CREATE TABLE task_events (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      from_state TEXT,
      to_state TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT,
      at INTEGER NOT NULL,
      PRIMARY KEY (task_id, seq)
    )`,
    `CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      tokens TEXT,
      cost REAL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL
    )`,
    `CREATE INDEX agent_runs_task_idx ON agent_runs(task_id)`,
    `CREATE TABLE tool_calls (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_run_id TEXT,
      tool_id TEXT NOT NULL,
      capability TEXT NOT NULL,
      scope TEXT,
      decision TEXT NOT NULL,
      decision_source TEXT NOT NULL,
      input_redacted TEXT,
      result_summary TEXT,
      duration_ms INTEGER,
      at INTEGER NOT NULL
    )`,
    `CREATE INDEX tool_calls_task_idx ON tool_calls(task_id)`,
    `CREATE TABLE checkpoints (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      head_before TEXT,
      base_snapshot_ref TEXT NOT NULL,
      result_commit TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX checkpoints_project_idx ON checkpoints(project_id)`,
    `CREATE TABLE project_memory (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      statement TEXT NOT NULL,
      provenance_task_id TEXT,
      confidence REAL NOT NULL,
      created_at INTEGER NOT NULL,
      superseded_by TEXT
    )`,
    `CREATE INDEX project_memory_project_idx ON project_memory(project_id)`,
    `CREATE TABLE usage_records (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      estimated_cost REAL,
      at INTEGER NOT NULL
    )`,
    `CREATE INDEX usage_records_task_idx ON usage_records(task_id)`,
    `CREATE TABLE permissions (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      capability TEXT NOT NULL,
      scope_pattern TEXT NOT NULL,
      decision TEXT NOT NULL,
      lifetime TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER
    )`,
    `CREATE INDEX permissions_project_idx ON permissions(project_id)`,
    `CREATE TABLE index_status (
      project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      state TEXT NOT NULL,
      files INTEGER NOT NULL DEFAULT 0,
      indexed INTEGER NOT NULL DEFAULT 0,
      last_full_at INTEGER,
      last_incremental_at INTEGER,
      error TEXT
    )`,
  ],
};
