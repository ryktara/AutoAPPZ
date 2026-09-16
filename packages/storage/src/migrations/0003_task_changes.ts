import type { Migration } from "../migration.ts";

export const m0003TaskChanges: Migration = {
  id: "0003_task_changes",
  up: [
    `CREATE TABLE task_changes (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      before TEXT,
      after TEXT,
      truncated INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (task_id, path)
    )`,
  ],
};
