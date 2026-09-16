import { z } from "zod";
import { defineCommand, defineEvent, defineQuery } from "../definitions.ts";

export const McpTransportSchema = z.enum(["stdio", "http"]);
export const McpAuthSchema = z.enum(["none", "bearer", "oauth"]);
export const McpStatusSchema = z.enum(["disconnected", "connecting", "connected", "error"]);

/** An MCP server the user added explicitly. Secrets (env values, bearer tokens, OAuth tokens) are secret ids. */
export const McpServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  transport: McpTransportSchema,
  /** stdio: executable and arguments (never a shell string). */
  command: z.string().min(1).max(500).optional(),
  args: z.array(z.string().max(500)).default([]),
  cwd: z.string().max(4096).optional(),
  /** http: Streamable HTTP endpoint. */
  url: z.url().optional(),
  auth: McpAuthSchema.default("none"),
  /** Environment variables for stdio servers: name → secret id. */
  envSecrets: z.record(z.string(), z.string()).default({}),
  /** Secret id holding the bearer token (auth: bearer) or the OAuth token set (auth: oauth). */
  tokenSecretId: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  status: McpStatusSchema.default("disconnected"),
  statusMessage: z.string().max(1000).optional(),
  toolCount: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative(),
});
export type McpServer = z.infer<typeof McpServerSchema>;

export const McpToolSchema = z.object({
  /** Tool id as registered with the agent (`mcp.<server>.<tool>`). */
  id: z.string(),
  name: z.string(),
  description: z.string(),
  risk: z.enum(["low", "medium", "high", "destructive"]),
});

export const mcpServers = defineQuery({
  name: "mcp.servers",
  input: z.void(),
  output: z.array(McpServerSchema),
  scope: "mcp",
});

export const mcpUpsert = defineCommand({
  name: "mcp.upsert",
  input: z.object({
    id: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(80),
    transport: McpTransportSchema,
    command: z.string().trim().min(1).max(500).optional(),
    args: z.array(z.string().max(500)).default([]),
    cwd: z.string().max(4096).optional(),
    url: z.url().optional(),
    auth: McpAuthSchema.default("none"),
    envSecrets: z.record(z.string(), z.string()).default({}),
    tokenSecretId: z.string().min(1).optional(),
    enabled: z.boolean().default(true),
  }),
  output: McpServerSchema,
  invalidates: ["mcp", "secrets"],
});

export const mcpDelete = defineCommand({
  name: "mcp.delete",
  input: z.object({ id: z.string().min(1) }),
  output: z.void(),
  invalidates: ["mcp", "secrets"],
});

/** Connects (spawns / opens) the server, lists its tools and registers them with the agent. OAuth servers may open the browser. */
export const mcpConnect = defineCommand({
  name: "mcp.connect",
  input: z.object({ id: z.string().min(1) }),
  output: z.object({ server: McpServerSchema, tools: z.array(McpToolSchema) }),
  invalidates: ["mcp"],
});

export const mcpDisconnect = defineCommand({
  name: "mcp.disconnect",
  input: z.object({ id: z.string().min(1) }),
  output: McpServerSchema,
  invalidates: ["mcp"],
});

export const mcpTools = defineQuery({
  name: "mcp.tools",
  input: z.object({ id: z.string().min(1) }),
  output: z.array(McpToolSchema),
  scope: "mcp",
});

export const mcpChanged = defineEvent({ name: "mcp.changed", payload: z.object({ id: z.string().min(1) }) });
