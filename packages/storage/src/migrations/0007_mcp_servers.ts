import type { Migration } from "../migration.ts";

export const m0007McpServers: Migration = {
  id: "0007_mcp_servers",
  up: [
    `CREATE TABLE mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport TEXT NOT NULL,
      command TEXT,
      args TEXT NOT NULL DEFAULT '[]',
      cwd TEXT,
      url TEXT,
      auth TEXT NOT NULL DEFAULT 'none',
      env_secrets TEXT NOT NULL DEFAULT '{}',
      token_secret_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'disconnected',
      status_message TEXT,
      tool_count INTEGER,
      updated_at INTEGER NOT NULL
    )`,
  ],
};
