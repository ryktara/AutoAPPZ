import type { Migration } from "../migration.ts";
import { m0001Initial } from "./0001_initial.ts";
import { m0002TaskModelError } from "./0002_task_model_error.ts";
import { m0003TaskChanges } from "./0003_task_changes.ts";
import { m0004TaskValidations } from "./0004_task_validations.ts";
import { m0005IntegrationsFields } from "./0005_integrations_fields.ts";
import { m0006Deployments } from "./0006_deployments.ts";
import { m0007McpServers } from "./0007_mcp_servers.ts";

/** Append only. Never edit a shipped migration; add a new one. */
export const ALL_MIGRATIONS: readonly Migration[] = [
  m0001Initial,
  m0002TaskModelError,
  m0003TaskChanges,
  m0004TaskValidations,
  m0005IntegrationsFields,
  m0006Deployments,
  m0007McpServers,
];
