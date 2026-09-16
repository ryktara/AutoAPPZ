// Fake MCP server over stdio for tests: two tools, one read-only and one destructive, plus an error case.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fake-stdio", version: "1.0.0" });

server.registerTool(
  "echo",
  {
    description: "Echoes the text back.",
    inputSchema: { text: z.string() },
    annotations: { readOnlyHint: true },
  },
  ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] }),
);

server.registerTool(
  "wipe",
  {
    description: "Pretends to wipe something.",
    inputSchema: { target: z.string() },
    annotations: { destructiveHint: true },
  },
  ({ target }) => ({ content: [{ type: "text", text: `wiped ${target}` }] }),
);

server.registerTool(
  "fail",
  { description: "Always fails.", inputSchema: {} },
  () => ({ content: [{ type: "text", text: "boom" }], isError: true }),
);

if (process.env.FAKE_MCP_SECRET) {
  server.registerTool("secret", { description: "Reveals the env secret length.", inputSchema: {} }, () => ({
    content: [{ type: "text", text: `secret length ${String(process.env.FAKE_MCP_SECRET.length)}` }],
  }));
}

await server.connect(new StdioServerTransport());
