import type { Migration } from "../migration.ts";

export const m0005IntegrationsFields: Migration = {
  id: "0005_integrations_fields",
  up: [
    `ALTER TABLE integrations ADD COLUMN name TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE integrations ADD COLUMN secret_id TEXT`,
    `ALTER TABLE integrations ADD COLUMN status_message TEXT`,
  ],
};
