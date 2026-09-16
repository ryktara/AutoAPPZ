import type { SecretRef } from "@autoappz/contracts";

// ---- database (M11)
export { classifySql, blank as blankSql } from "./database/sql-classifier.ts";
export type { SqlClassification, SqlKind } from "./database/sql-classifier.ts";
export type {
  ColumnInfo,
  ConnectionTarget,
  DatabaseAdapter,
  DatabaseAdapterId,
  DiscoveredInstance,
  ForeignKeyInfo,
  Integration,
  QueryResult,
  SchemaSnapshot,
  SqlExecutor,
  SqlExecutorFactory,
  TableInfo,
} from "./database/types.ts";
export { assertPostgresUrl, postgresAdapter, redactConnectionString } from "./database/adapters/postgres.ts";
export { SUPABASE_API, supabaseAdapter } from "./database/adapters/supabase.ts";
export { NEON_API, neonAdapter } from "./database/adapters/neon.ts";
export {
  MAX_ROWS,
  ProjectDatabase,
  STATEMENT_TIMEOUT_MS,
  createPgExecutor,
  renderSchema,
} from "./database/gateway.ts";
export type { ProjectDatabaseOptions } from "./database/gateway.ts";
export { createDatabaseTools } from "./database/tools.ts";
export type { DatabaseToolsOptions } from "./database/tools.ts";

import { neonAdapter } from "./database/adapters/neon.ts";
import { postgresAdapter } from "./database/adapters/postgres.ts";
import { supabaseAdapter } from "./database/adapters/supabase.ts";
import type { DatabaseAdapter, DatabaseAdapterId } from "./database/types.ts";

export const DATABASE_ADAPTERS: readonly DatabaseAdapter[] = [postgresAdapter, supabaseAdapter, neonAdapter];

export function databaseAdapter(id: DatabaseAdapterId): DatabaseAdapter {
  const adapter = DATABASE_ADAPTERS.find((a) => a.id === id);
  if (!adapter) throw new Error(`Unknown database adapter ${id}`);
  return adapter;
}

// ---- interfaces for later milestones (M12 deployment, M13 MCP)
export interface DeploymentProvider {
  readonly id: string;
  deploy(input: {
    projectRoot: string;
    credential: SecretRef;
    signal: AbortSignal;
  }): Promise<{ url: string; id: string }>;
}

export interface McpClient {
  listTools(): Promise<readonly { name: string; description: string }[]>;
  call(tool: string, input: unknown, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}
