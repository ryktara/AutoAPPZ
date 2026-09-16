import type { Migration } from "../migration.ts";

export const m0006Deployments: Migration = {
  id: "0006_deployments",
  up: [
    `CREATE TABLE deployment_targets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      adapter_id TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      secret_id TEXT,
      env_secrets TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX deployment_targets_project_idx ON deployment_targets(project_id)`,
    `CREATE TABLE deployments (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL REFERENCES deployment_targets(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      adapter_id TEXT NOT NULL,
      status TEXT NOT NULL,
      url TEXT,
      provider_ref TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      error TEXT,
      log TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE INDEX deployments_project_idx ON deployments(project_id, started_at)`,
  ],
};
