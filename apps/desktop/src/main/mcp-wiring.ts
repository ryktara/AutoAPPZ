import type { CommandBusHost } from "@autoappz/command-bus";
import { AppError, mcp as contracts, workspace } from "@autoappz/contracts";
import type { Logger } from "@autoappz/diagnostics";
import {
  LoopbackOAuthProvider,
  McpConnection,
  bridgeMcpTools,
  mcpToolId,
  riskFor,
  type McpToolInfo,
  type OAuthState,
} from "@autoappz/integrations";
import type { SecretService } from "@autoappz/secrets";
import type { McpServersRepository } from "@autoappz/storage";
import type { ToolRuntime } from "@autoappz/tools";

type McpServer = contracts.McpServer;

interface LiveServer {
  connection: McpConnection;
  tools: McpToolInfo[];
  toolIds: string[];
  oauth?: LoopbackOAuthProvider | undefined;
}

export interface McpWiring {
  close(): Promise<void>;
}

/**
 * MCP servers the user added explicitly: connect on demand (or at startup when enabled), bridge their
 * tools into the agent runtime under `mcp.call` consent, and keep secrets in the main process.
 */
export function createMcpWiring(input: {
  bus: CommandBusHost;
  repo: McpServersRepository;
  secrets: SecretService;
  tools: ToolRuntime;
  logger: Logger;
  appVersion: string;
  /** Opens the OAuth authorization URL in the system browser. */
  openExternal: (url: string) => Promise<void>;
  now?: (() => number) | undefined;
  newId?: ((prefix: string) => string) | undefined;
}): McpWiring {
  const now = input.now ?? Date.now;
  const newId =
    input.newId ??
    ((prefix: string) => `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
  const live = new Map<string, LiveServer>();

  const changed = (id: string) => {
    input.bus.publish(contracts.mcpChanged, { id });
    input.bus.publish(workspace.cacheInvalidate, { scopes: ["mcp"] });
  };
  const serverOf = (id: string): McpServer => {
    const s = input.repo.get(id);
    if (!s) throw new AppError("not_found", "mcp.not_found", "MCP server not found.", { details: { id } });
    return s;
  };
  const toolSummaries = (server: McpServer, tools: readonly McpToolInfo[]) =>
    tools.map((t) => ({
      id: mcpToolId(server.id, t.name),
      name: t.name,
      description: t.description,
      risk: riskFor(t),
    }));

  const oauthProviderFor = (server: McpServer): LoopbackOAuthProvider => {
    const secretId = server.tokenSecretId;
    return new LoopbackOAuthProvider({
      clientName: "AutoAPPZ",
      load: async () => {
        if (!secretId) return {};
        const raw = await input.secrets.resolve({ id: secretId });
        try {
          return raw ? (JSON.parse(raw) as OAuthState) : {};
        } catch {
          return {};
        }
      },
      save: async (state) => {
        const ref = await input.secrets.set({
          kind: "oauth-token",
          provider: `mcp:${server.id}`,
          label: `${server.name} (MCP OAuth)`,
          value: JSON.stringify(state),
          replaceId: secretId,
        });
        if (ref.id !== server.tokenSecretId)
          input.repo.upsert({ ...serverOf(server.id), tokenSecretId: ref.id, updatedAt: now() });
      },
      openAuthorizationUrl: (url) => input.openExternal(url.toString()),
    });
  };

  const disconnect = async (id: string) => {
    const state = live.get(id);
    if (!state) return;
    live.delete(id);
    for (const toolId of state.toolIds) input.tools.unregister(toolId);
    state.oauth?.close();
    await state.connection.close().catch(() => undefined);
  };

  const connect = async (server: McpServer): Promise<{ server: McpServer; tools: McpToolInfo[] }> => {
    await disconnect(server.id);
    input.repo.setStatus(server.id, "connecting", undefined, undefined, now());
    changed(server.id);
    const env: Record<string, string> = {};
    for (const [name, secretId] of Object.entries(server.envSecrets)) {
      const value = await input.secrets.resolve({ id: secretId });
      if (value !== undefined) env[name] = value;
    }
    let oauth: LoopbackOAuthProvider | undefined;
    let bearerToken: string | undefined;
    if (server.auth === "oauth") oauth = oauthProviderFor(server);
    else if (server.auth === "bearer" && server.tokenSecretId)
      bearerToken = await input.secrets.resolve({ id: server.tokenSecretId });
    try {
      const connection = await McpConnection.connect(server, {
        env,
        bearerToken,
        authProvider: oauth,
        logger: input.logger.child(`mcp:${server.id}`),
        clientInfo: { name: "autoappz", version: input.appVersion },
      });
      const tools = await connection.listTools();
      const bridged = bridgeMcpTools(tools, {
        serverId: server.id,
        serverName: server.name,
        call: (name, args, signal) => connection.callTool(name, args, signal),
      });
      const toolIds: string[] = [];
      for (const tool of bridged) {
        input.tools.unregister(tool.id);
        input.tools.register(tool);
        toolIds.push(tool.id);
      }
      live.set(server.id, { connection, tools, toolIds, oauth });
      input.repo.setStatus(server.id, "connected", undefined, tools.length, now());
      changed(server.id);
      input.logger.info("mcp server connected", {
        id: server.id,
        transport: server.transport,
        tools: tools.length,
      });
      return { server: serverOf(server.id), tools };
    } catch (error) {
      oauth?.close();
      const message = error instanceof Error ? error.message : String(error);
      input.repo.setStatus(server.id, "error", message, undefined, now());
      changed(server.id);
      throw error instanceof AppError ? error : new AppError("external", "mcp.connect_failed", message);
    }
  };

  // ---- handlers
  input.bus.handle(contracts.mcpServers, () => input.repo.list());
  input.bus.handle(contracts.mcpUpsert, async (req) => {
    const existing = req.id ? input.repo.get(req.id) : undefined;
    if (req.transport === "stdio" && !req.command)
      throw new AppError("validation", "mcp.invalid_config", "A stdio server needs a command.");
    if (req.transport === "http" && !req.url)
      throw new AppError("validation", "mcp.invalid_config", "An HTTP server needs a URL.");
    if (req.tokenSecretId && (await input.secrets.resolve({ id: req.tokenSecretId })) === undefined)
      throw new AppError("not_found", "mcp.secret_missing", "The referenced secret does not exist.");
    const server: McpServer = {
      id: existing?.id ?? newId("mcp"),
      name: req.name,
      transport: req.transport,
      args: req.args,
      auth: req.auth,
      envSecrets: req.envSecrets,
      enabled: req.enabled,
      status: "disconnected",
      updatedAt: now(),
      ...(req.command !== undefined ? { command: req.command } : {}),
      ...(req.cwd !== undefined ? { cwd: req.cwd } : {}),
      ...(req.url !== undefined ? { url: req.url } : {}),
      ...(req.tokenSecretId !== undefined
        ? { tokenSecretId: req.tokenSecretId }
        : existing?.tokenSecretId
          ? { tokenSecretId: existing.tokenSecretId }
          : {}),
    };
    if (existing) await disconnect(existing.id);
    input.repo.upsert(server);
    changed(server.id);
    return server;
  });
  input.bus.handle(contracts.mcpDelete, async ({ id }) => {
    const server = input.repo.get(id);
    if (!server) return;
    await disconnect(id);
    if (server.tokenSecretId) await input.secrets.delete(server.tokenSecretId).catch(() => undefined);
    for (const secretId of Object.values(server.envSecrets))
      await input.secrets.delete(secretId).catch(() => undefined);
    input.repo.delete(id);
    changed(id);
  });
  input.bus.handle(contracts.mcpConnect, async ({ id }) => {
    const result = await connect(serverOf(id));
    return { server: result.server, tools: toolSummaries(result.server, result.tools) };
  });
  input.bus.handle(contracts.mcpDisconnect, async ({ id }) => {
    const server = serverOf(id);
    await disconnect(id);
    input.repo.setStatus(id, "disconnected", undefined, undefined, now());
    changed(id);
    return serverOf(server.id);
  });
  input.bus.handle(contracts.mcpTools, ({ id }) => {
    const server = serverOf(id);
    return toolSummaries(server, live.get(id)?.tools ?? []);
  });

  // Enabled servers reconnect in the background at startup; failures are recorded, never fatal.
  for (const server of input.repo.list()) {
    if (!server.enabled || server.auth === "oauth") continue;
    connect(server).catch((error: unknown) => {
      input.logger.warn("mcp server failed to reconnect", { id: server.id, message: String(error) });
    });
  }

  return {
    async close() {
      for (const id of [...live.keys()]) await disconnect(id);
    },
  };
}
