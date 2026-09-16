import { asc, eq } from "drizzle-orm";
import { mcp as contracts } from "@autoappz/contracts";
import type { PlatformDb } from "../database.ts";
import { mcpServers } from "../schema.ts";

type McpServer = contracts.McpServer;

export class McpServersRepository {
  constructor(private readonly db: PlatformDb) {}

  list(): McpServer[] {
    return this.db.select().from(mcpServers).orderBy(asc(mcpServers.name)).all().map(toServer);
  }

  get(id: string): McpServer | undefined {
    const row = this.db.select().from(mcpServers).where(eq(mcpServers.id, id)).get();
    return row ? toServer(row) : undefined;
  }

  upsert(s: McpServer): void {
    const values = {
      id: s.id,
      name: s.name,
      transport: s.transport,
      command: s.command ?? null,
      args: JSON.stringify(s.args),
      cwd: s.cwd ?? null,
      url: s.url ?? null,
      auth: s.auth,
      envSecrets: JSON.stringify(s.envSecrets),
      tokenSecretId: s.tokenSecretId ?? null,
      enabled: s.enabled ? 1 : 0,
      status: s.status,
      statusMessage: s.statusMessage ?? null,
      toolCount: s.toolCount ?? null,
      updatedAt: s.updatedAt,
    };
    this.db
      .insert(mcpServers)
      .values(values)
      .onConflictDoUpdate({ target: mcpServers.id, set: values })
      .run();
  }

  setStatus(
    id: string,
    status: McpServer["status"],
    message: string | undefined,
    toolCount: number | undefined,
    at: number,
  ): void {
    this.db
      .update(mcpServers)
      .set({ status, statusMessage: message ?? null, toolCount: toolCount ?? null, updatedAt: at })
      .where(eq(mcpServers.id, id))
      .run();
  }

  delete(id: string): boolean {
    return this.db.delete(mcpServers).where(eq(mcpServers.id, id)).run().changes > 0;
  }
}

function toServer(row: typeof mcpServers.$inferSelect): McpServer {
  return contracts.McpServerSchema.parse({
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command ?? undefined,
    args: JSON.parse(row.args) as unknown,
    cwd: row.cwd ?? undefined,
    url: row.url ?? undefined,
    auth: row.auth,
    envSecrets: JSON.parse(row.envSecrets) as unknown,
    tokenSecretId: row.tokenSecretId ?? undefined,
    enabled: row.enabled === 1,
    status: row.status,
    statusMessage: row.statusMessage ?? undefined,
    toolCount: row.toolCount ?? undefined,
    updatedAt: row.updatedAt,
  });
}
