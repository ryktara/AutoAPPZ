import type { Migration } from "../migration.ts";

export const m0004TaskValidations: Migration = {
  id: "0004_task_validations",
  up: [
    `ALTER TABLE tasks ADD COLUMN intent TEXT NOT NULL DEFAULT 'change'`,
    `CREATE TABLE task_validations (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      attempt INTEGER NOT NULL,
      report TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX task_validations_task_idx ON task_validations(task_id, attempt)`,
  ],
};
