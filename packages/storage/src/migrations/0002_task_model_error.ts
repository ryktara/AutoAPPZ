import type { Migration } from "../migration.ts";

export const m0002TaskModelError: Migration = {
  id: "0002_task_model_error",
  up: [
    "ALTER TABLE tasks ADD COLUMN model TEXT",
    "ALTER TABLE tasks ADD COLUMN error TEXT",
    "ALTER TABLE tasks ADD COLUMN mode TEXT NOT NULL DEFAULT ask",
  ],
};
