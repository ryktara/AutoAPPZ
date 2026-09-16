import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { AppError, type mcp as contracts } from "@autoappz/contracts";
import type { Logger } from "@autoappz/diagnostics";
import { buildChildEnv, resolveExecutable } from "@autoappz/runtime";

export type McpServerConfig = contracts.McpServer;

export interface McpToolInfo {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: { readOnly: boolean; destructive: boolean; idempotent: boolean };
}

export interface McpCallResult {
  /** Text content joined; non-text content summarised. Always treated as untrusted data. */
  readonly text: string;
  readonly isError: boolean;
}

export interface ConnectOptions {
  /** Resolved secret values for stdio env (name → value). */
  readonly env?: Record<string, string> | undefined;
  /** Bearer token for http servers (auth: bearer). */
  readonly bearerToken?: string | undefined;
  /** OAuth provider for http servers (auth: oauth); see loopback-oauth.ts. */
  readonly authProvider?: (OAuthClientProvider & { waitForAuthorizationCode(): Promise<string> }) | undefined;
  readonly timeoutMs?: number | undefined;
  readonly logger?: Logger | undefined;
  readonly clientInfo?: { name: string; version: string } | undefined;
}

export const DEFAULT_MCP_TIMEOUT_MS = 30_000;
const MAX_RESULT_CHARS = 16_000;

/**
 * One connected MCP server. Stdio servers are spawned as argument arrays with the runtime env
 * allowlist; HTTP servers use Streamable HTTP with bearer or OAuth (loopback PKCE) auth.
 */
export class McpConnection {
  private constructor(
    private readonly client: Client,
    private readonly transportClose: () => Promise<void>,
    readonly serverId: string,
    private readonly timeoutMs: number,
    private readonly log: Logger | undefined,
  ) {}

  static async connect(config: McpServerConfig, options: ConnectOptions = {}): Promise<McpConnection> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;
    const client = new Client(options.clientInfo ?? { name: "autoappz", version: "0.0.0" }, {
      capabilities: {},
    });
    if (config.transport === "stdio") {
      if (!config.command)
        throw new AppError("validation", "mcp.invalid_config", "A stdio server needs a command.");
      const resolved = resolveExecutable(config.command);
      if (!resolved)
        throw new AppError(
          "precondition",
          "mcp.command_not_found",
          `"${config.command}" was not found on PATH.`,
        );
      const transport = new StdioClientTransport({
        command: resolved.file,
        args: [...resolved.args, ...config.args],
        env: buildChildEnv(process.env, options.env ?? {}),
        ...(config.cwd ? { cwd: config.cwd } : {}),
        stderr: "pipe",
      });
      transport.stderr?.on("data", (chunk: Buffer) => {
        options.logger?.debug("mcp stderr", {
          server: config.id,
          text: chunk.toString("utf8").slice(0, 500),
        });
      });
      await withTimeout(client.connect(asTransport(transport)), timeoutMs, "connect");
      return new McpConnection(client, () => transport.close(), config.id, timeoutMs, options.logger);
    }
    if (!config.url) throw new AppError("validation", "mcp.invalid_config", "An HTTP server needs a URL.");
    const headers: Record<string, string> = options.bearerToken
      ? { Authorization: `Bearer ${options.bearerToken}` }
      : {};
    const makeTransport = () =>
      new StreamableHTTPClientTransport(new URL(config.url ?? ""), {
        requestInit: { headers },
        ...(options.authProvider ? { authProvider: options.authProvider } : {}),
      });
    let transport = makeTransport();
    try {
      await withTimeout(client.connect(asTransport(transport)), timeoutMs, "connect");
    } catch (error) {
      if (!(error instanceof UnauthorizedError) || !options.authProvider) throw mapError(error);
      // The provider opened the authorization URL; wait for the loopback redirect, finish, reconnect.
      const code = await withTimeout(
        options.authProvider.waitForAuthorizationCode(),
        5 * 60_000,
        "authorization",
      );
      await transport.finishAuth(code);
      transport = makeTransport();
      await withTimeout(client.connect(asTransport(transport)), timeoutMs, "connect");
    }
    return new McpConnection(client, () => transport.close(), config.id, timeoutMs, options.logger);
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = await withTimeout(this.client.listTools(), this.timeoutMs, "listTools");
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema as Record<string, unknown> | undefined) ?? { type: "object" },
      annotations: {
        readOnly: t.annotations?.readOnlyHint === true,
        destructive: t.annotations?.destructiveHint === true,
        idempotent: t.annotations?.idempotentHint === true,
      },
    }));
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    let result;
    try {
      result = await withTimeout(
        this.client.callTool({ name, arguments: args }, undefined, {
          timeout: this.timeoutMs,
          ...(signal ? { signal } : {}),
        }),
        this.timeoutMs + 1_000,
        "callTool",
      );
    } catch (error) {
      throw mapError(error);
    }
    const content = Array.isArray(result.content)
      ? (result.content as { type: string; text?: string; mimeType?: string }[])
      : [];
    const parts = content.map((c) =>
      c.type === "text" && typeof c.text === "string"
        ? c.text
        : `[${c.type}${c.mimeType ? ` ${c.mimeType}` : ""} content omitted]`,
    );
    const text = parts.join("\n").slice(0, MAX_RESULT_CHARS);
    this.log?.debug("mcp tool called", {
      server: this.serverId,
      tool: name,
      isError: result.isError === true,
      chars: text.length,
    });
    return { text, isError: result.isError === true };
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } finally {
      await this.transportClose().catch(() => undefined);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new AppError(
            "timeout",
            "mcp.timeout",
            `MCP ${what} timed out after ${String(Math.round(ms / 1000))} s.`,
          ),
        ),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function mapError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AppError("external", "mcp.error", message);
}

/** The SDK transport types are not authored for exactOptionalPropertyTypes; the objects are correct at runtime. */
function asTransport(transport: StdioClientTransport | StreamableHTTPClientTransport): Transport {
  return transport as unknown as Transport;
}
