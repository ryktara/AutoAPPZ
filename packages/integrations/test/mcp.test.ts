import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PermissionEngine } from "@autoappz/permissions";
import { Redactor } from "@autoappz/diagnostics";
import { ReadLedger, ToolRuntime } from "@autoappz/tools";
import {
  LoopbackOAuthProvider,
  McpConnection,
  bridgeMcpTools,
  mcpToolId,
  riskFor,
  type McpServerConfig,
  type OAuthState,
} from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "mcp-stdio-server.mjs");

const stdioConfig = (extra: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: "fake",
  name: "Fake",
  transport: "stdio",
  command: process.execPath,
  args: [FIXTURE],
  auth: "none",
  envSecrets: {},
  enabled: true,
  status: "disconnected",
  updatedAt: 0,
  ...extra,
});

describe("McpConnection over stdio", () => {
  it("spawns the server as an argument array, lists tools with annotations and calls them", async () => {
    const connection = await McpConnection.connect(stdioConfig(), {
      env: { FAKE_MCP_SECRET: "hunter2" },
      timeoutMs: 20_000,
    });
    try {
      const tools = await connection.listTools();
      expect(tools.map((t) => [t.name, t.annotations.readOnly, t.annotations.destructive])).toEqual([
        ["echo", true, false],
        ["wipe", false, true],
        ["fail", false, false],
        ["secret", false, false],
      ]);
      expect(tools[0]?.inputSchema).toMatchObject({
        type: "object",
        properties: { text: { type: "string" } },
      });
      expect(await connection.callTool("echo", { text: "hi" })).toEqual({ text: "echo: hi", isError: false });
      expect(await connection.callTool("fail", {})).toEqual({ text: "boom", isError: true });
      // env values reach the child process (secrets resolved by the host), nothing else from the platform env
      expect((await connection.callTool("secret", {})).text).toBe("secret length 7");
    } finally {
      await connection.close();
    }
  }, 30_000);

  it("reports a missing command clearly", async () => {
    await expect(
      McpConnection.connect(stdioConfig({ command: "definitely-not-a-command-xyz" })),
    ).rejects.toMatchObject({ code: "mcp.command_not_found" });
  });
});

describe("bridge into the agent tool runtime", () => {
  it("maps annotations to risk, namespaces ids, asks for consent by default and wraps results as untrusted data", async () => {
    const connection = await McpConnection.connect(stdioConfig(), { timeoutMs: 20_000 });
    try {
      const infos = await connection.listTools();
      const tools = bridgeMcpTools(infos, {
        serverId: "fake",
        serverName: "Fake",
        call: (name, args, signal) => connection.callTool(name, args, signal),
      });
      expect(tools.map((t) => [t.id, t.permission.risk, t.mutates])).toEqual([
        ["mcp.fake.echo", "medium", false],
        ["mcp.fake.wipe", "destructive", true],
        ["mcp.fake.fail", "high", true],
      ]);
      expect(mcpToolId("my server", "do/thing")).toBe("mcp.my_server.do_thing");
      expect(riskFor(infos[1]!)).toBe("destructive");
      const decisions: string[] = [];
      const runtime = new ToolRuntime({
        tools,
        permissions: new PermissionEngine({
          store: {
            list: () => [
              {
                id: "p",
                capability: "mcp.call",
                scopePattern: "fake/echo",
                decision: "allow",
                lifetime: "project",
                createdAt: 0,
              },
            ],
            insert: () => undefined,
            delete: () => false,
          },
          consentTimeoutMs: 200,
        }),
        audit: { record: (e) => decisions.push(`${e.toolId}:${e.decision}`) },
        redactor: new Redactor(),
      });
      const spec = runtime.specs().find((s) => s.name === "mcp.fake.echo");
      expect(spec?.inputSchema).toMatchObject({ properties: { text: { type: "string" } } });
      const ctx = {
        projectId: "p",
        projectRoot: here,
        taskId: "t",
        signal: new AbortController().signal,
        ledger: new ReadLedger(),
      };
      const ok = await runtime.execute({ toolId: "mcp.fake.echo", input: { text: "hello" }, ...ctx });
      expect(ok.ok).toBe(true);
      expect(ok.summaryForModel).toContain('<mcp_result server="Fake" tool="echo"');
      expect(ok.summaryForModel).toContain("untrusted data");
      // no policy for wipe (destructive) → consent is required and times out → denied, never executed
      const denied = await runtime.execute({ toolId: "mcp.fake.wipe", input: { target: "x" }, ...ctx });
      expect(denied.ok).toBe(false);
      expect(decisions).toEqual(["mcp.fake.echo:allow", "mcp.fake.wipe:deny"]);
      const failed = await runtime.execute({ toolId: "mcp.fake.fail", input: {}, ...ctx });
      expect(failed.ok).toBe(false);
    } finally {
      await connection.close();
    }
  }, 30_000);
});

/** Streamable HTTP MCP server + a minimal OAuth authorization server on one origin. */
function fakeHttpMcp(options: { requireAuth: boolean }) {
  // Stateless transport: one McpServer + transport per request.
  const makeMcp = () => {
    const mcp = new McpServer({ name: "fake-http", version: "1.0.0" });
    mcp.registerTool(
      "ping",
      { description: "Ping.", inputSchema: { n: z.number().optional() } },
      ({ n }) => ({
        content: [{ type: "text", text: `pong ${String(n ?? 0)}` }],
      }),
    );
    return mcp;
  };
  const issued = new Set<string>();
  const seen: string[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    seen.push(`${req.method ?? ""} ${url.pathname}`);
    const json = (status: number, body: unknown): boolean => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
      return true;
    };
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      const origin = `http://127.0.0.1:${String((server.address() as { port: number }).port)}`;
      return json(200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname.startsWith("/.well-known/")) return json(404, {});
    if (url.pathname === "/register" && req.method === "POST") {
      return json(201, { client_id: "client-1", redirect_uris: [], token_endpoint_auth_method: "none" });
    }
    if (url.pathname === "/authorize") {
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
      redirect.searchParams.set("code", "code-1");
      const state = url.searchParams.get("state");
      if (state) redirect.searchParams.set("state", state);
      res.statusCode = 302;
      res.setHeader("location", redirect.toString());
      res.end();
      return true;
    }
    if (url.pathname === "/token" && req.method === "POST") {
      const token = `tok-${String(issued.size + 1)}`;
      issued.add(token);
      return json(200, { access_token: token, token_type: "Bearer", expires_in: 3600 });
    }
    if (url.pathname === "/mcp") {
      const auth = req.headers.authorization ?? "";
      if (options.requireAuth && !issued.has(auth.replace("Bearer ", ""))) {
        res.statusCode = 401;
        res.setHeader("WWW-Authenticate", 'Bearer realm="mcp"');
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body =
          chunks.length > 0 ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown) : undefined;
        // Stateless transport per request; SDK option/transport types are not authored for exactOptionalPropertyTypes.
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
        void makeMcp()
          .connect(transport as unknown as Transport)
          .then(() => transport.handleRequest(req, res, body));
      });
      return true;
    }
    return json(404, {});
  });
  return { server, seen, issued };
}

describe("McpConnection over Streamable HTTP", () => {
  const open = fakeHttpMcp({ requireAuth: false });
  const secured = fakeHttpMcp({ requireAuth: true });
  let openUrl = "";
  let securedUrl = "";
  beforeAll(async () => {
    await new Promise<void>((r) => open.server.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => secured.server.listen(0, "127.0.0.1", r));
    openUrl = `http://127.0.0.1:${String((open.server.address() as { port: number }).port)}/mcp`;
    securedUrl = `http://127.0.0.1:${String((secured.server.address() as { port: number }).port)}/mcp`;
  });
  afterAll(async () => {
    open.server.closeAllConnections();
    secured.server.closeAllConnections();
    await new Promise<void>((r) => open.server.close(() => r()));
    await new Promise<void>((r) => secured.server.close(() => r()));
  });

  it("connects without auth and with a bearer token", async () => {
    const connection = await McpConnection.connect(
      stdioConfig({ id: "http", transport: "http", url: openUrl, command: undefined, args: [] }),
      { timeoutMs: 20_000 },
    );
    try {
      expect((await connection.listTools()).map((t) => t.name)).toEqual(["ping"]);
      expect(await connection.callTool("ping", { n: 3 })).toEqual({ text: "pong 3", isError: false });
    } finally {
      await connection.close();
    }
    secured.issued.add("static-token");
    const bearer = await McpConnection.connect(
      stdioConfig({
        id: "http2",
        transport: "http",
        url: securedUrl,
        auth: "bearer",
        command: undefined,
        args: [],
      }),
      { bearerToken: "static-token", timeoutMs: 20_000 },
    );
    try {
      expect(await bearer.callTool("ping", {})).toEqual({ text: "pong 0", isError: false });
    } finally {
      await bearer.close();
    }
    await expect(
      McpConnection.connect(
        stdioConfig({
          id: "http3",
          transport: "http",
          url: securedUrl,
          auth: "bearer",
          command: undefined,
          args: [],
        }),
        { bearerToken: "wrong", timeoutMs: 20_000 },
      ),
    ).rejects.toMatchObject({ code: "mcp.error" });
  }, 30_000);

  it("completes the OAuth loopback flow: registration, PKCE authorization, token exchange, reconnect", async () => {
    let state: OAuthState = {};
    const opened: string[] = [];
    const provider = new LoopbackOAuthProvider({
      load: () => Promise.resolve(state),
      save: (s) => {
        state = s;
        return Promise.resolve();
      },
      // Simulates the user's browser: follows the authorization redirect back to the loopback listener.
      openAuthorizationUrl: async (url) => {
        opened.push(url.toString());
        const res = await fetch(url, { redirect: "manual" });
        const location = res.headers.get("location");
        if (!location) throw new Error("no redirect");
        await fetch(location);
      },
    });
    try {
      const connection = await McpConnection.connect(
        stdioConfig({
          id: "oauth",
          transport: "http",
          url: securedUrl,
          auth: "oauth",
          command: undefined,
          args: [],
        }),
        { authProvider: provider, timeoutMs: 20_000 },
      );
      try {
        expect(await connection.callTool("ping", { n: 9 })).toEqual({ text: "pong 9", isError: false });
      } finally {
        await connection.close();
      }
      expect(opened).toHaveLength(1);
      const authorize = new URL(opened[0] ?? "");
      expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
      expect(authorize.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      expect(state.tokens?.access_token).toMatch(/^tok-/);
      expect(state.clientInformation?.client_id).toBe("client-1");
      expect(secured.seen).toEqual(
        expect.arrayContaining(["POST /register", "POST /token", "GET /authorize"]),
      );
    } finally {
      provider.close();
    }
  }, 30_000);
});
