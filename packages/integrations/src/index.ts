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

// ---- deployment (M12)
export type {
  DeployEvent,
  DeployInput,
  DeploymentAdapter,
  DeploymentAdapterId,
  DeploymentTarget,
  DiscoveredSite,
  Framework,
  FrameworkInfo,
  ReadinessItem,
} from "./deployment/types.ts";
export { detectFramework } from "./deployment/framework.ts";
export {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  collectFiles,
  contentTypeFor,
  digest,
} from "./deployment/files.ts";
export type { UploadFile } from "./deployment/files.ts";
export { DOCKERIGNORE, renderDockerfile } from "./deployment/dockerfile.ts";
export { buildReadiness } from "./deployment/readiness.ts";
export type { ReadinessContext } from "./deployment/readiness.ts";
export { VERCEL_API, vercelAdapter } from "./deployment/adapters/vercel.ts";
export { NETLIFY_API, netlifyAdapter } from "./deployment/adapters/netlify.ts";
export { CLOUDFLARE_API, cloudflareAdapter } from "./deployment/adapters/cloudflare.ts";
export { DOCKER_BUILD_TIMEOUT_MS, createDockerAdapter, imageTagFor } from "./deployment/adapters/docker.ts";
export type { DockerAdapterOptions } from "./deployment/adapters/docker.ts";

import type { DockerAdapterOptions } from "./deployment/adapters/docker.ts";
import { cloudflareAdapter } from "./deployment/adapters/cloudflare.ts";
import { createDockerAdapter } from "./deployment/adapters/docker.ts";
import { netlifyAdapter } from "./deployment/adapters/netlify.ts";
import { vercelAdapter } from "./deployment/adapters/vercel.ts";
import type { DeploymentAdapter, DeploymentAdapterId } from "./deployment/types.ts";

export function createDeploymentAdapters(
  options: { docker?: DockerAdapterOptions | undefined } = {},
): DeploymentAdapter[] {
  return [vercelAdapter, netlifyAdapter, cloudflareAdapter, createDockerAdapter(options.docker)];
}

export function deploymentAdapter(
  adapters: readonly DeploymentAdapter[],
  id: DeploymentAdapterId,
): DeploymentAdapter {
  const adapter = adapters.find((a) => a.id === id);
  if (!adapter) throw new Error(`Unknown deployment adapter ${id}`);
  return adapter;
}

// ---- MCP (M13)
export { DEFAULT_MCP_TIMEOUT_MS, McpConnection } from "./mcp/client.ts";
export type { ConnectOptions, McpCallResult, McpServerConfig, McpToolInfo } from "./mcp/client.ts";
export { LoopbackOAuthProvider } from "./mcp/loopback-oauth.ts";
export type { LoopbackOAuthOptions, OAuthState } from "./mcp/loopback-oauth.ts";
export { MCP_TOOL_PREFIX, bridgeMcpTools, mcpToolId, riskFor } from "./mcp/bridge.ts";
export type { BridgeOptions } from "./mcp/bridge.ts";
