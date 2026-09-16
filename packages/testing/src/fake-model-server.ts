import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Deterministic OpenAI-compatible chat-completions server for tests and e2e.
 * Scenarios match the latest user message; each scenario is a list of turns consumed as the
 * conversation grows (turn index = number of assistant messages already in the request).
 */
export interface FakeToolCall {
  readonly name: string;
  readonly input: unknown;
}

export interface FakeTurn {
  readonly text?: string | undefined;
  readonly reasoning?: string | undefined;
  readonly toolCalls?: readonly FakeToolCall[] | undefined;
  readonly usage?: { input: number; output: number } | undefined;
  /** Milliseconds between streamed chunks. */
  readonly chunkDelayMs?: number | undefined;
  /** Respond with an HTTP error instead of a completion. */
  readonly httpError?: { status: number; message: string } | undefined;
}

export interface FakeScenario {
  /** Tested against the latest user message text. */
  readonly match: RegExp | string;
  readonly turns: readonly FakeTurn[];
}

export interface FakeModelServerOptions {
  readonly scenarios: readonly FakeScenario[];
  readonly models?: readonly string[] | undefined;
  /** When set, requests must carry `Authorization: Bearer <apiKey>`. */
  readonly apiKey?: string | undefined;
  readonly port?: number | undefined;
}

export interface RecordedRequest {
  readonly path: string;
  readonly body: unknown;
  readonly headers: Record<string, string | string[] | undefined>;
}

export interface FakeModelServer {
  readonly baseUrl: string;
  readonly requests: readonly RecordedRequest[];
  close(): Promise<void>;
}

interface ChatBody {
  model?: string;
  messages?: { role: string; content?: unknown; tool_calls?: unknown[] }[];
  stream?: boolean;
}

export async function startFakeModelServer(options: FakeModelServerOptions): Promise<FakeModelServer> {
  const requests: RecordedRequest[] = [];
  const models = options.models ?? ["fake-model", "fake-model-mini"];

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      sendJson(res, 500, { error: { message: error instanceof Error ? error.message : String(error) } });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const body = await readBody(req);
    requests.push({ path: url.pathname, body, headers: req.headers });

    if (options.apiKey !== undefined && req.headers.authorization !== `Bearer ${options.apiKey}`) {
      sendJson(res, 401, { error: { message: "Invalid API key", type: "invalid_request_error" } });
      return;
    }
    if (req.method === "GET" && url.pathname.endsWith("/models")) {
      sendJson(res, 200, {
        object: "list",
        data: models.map((id) => ({ id, object: "model", owned_by: "fake" })),
      });
      return;
    }
    if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
      await chat(body as ChatBody, res);
      return;
    }
    sendJson(res, 404, { error: { message: `No route for ${req.method ?? "?"} ${url.pathname}` } });
  }

  async function chat(body: ChatBody, res: ServerResponse): Promise<void> {
    const messages = body.messages ?? [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const text =
      typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content ?? "");
    const scenario = options.scenarios.find((s) =>
      typeof s.match === "string" ? text.includes(s.match) : s.match.test(text),
    );
    if (!scenario) {
      sendJson(res, 400, {
        error: { message: `fake model server: no scenario matches "${text.slice(0, 80)}"` },
      });
      return;
    }
    const turnIndex = messages.filter((m) => m.role === "assistant").length;
    const turn = scenario.turns[Math.min(turnIndex, scenario.turns.length - 1)];
    if (!turn) {
      sendJson(res, 400, { error: { message: "fake model server: scenario has no turns" } });
      return;
    }
    if (turn.httpError) {
      sendJson(res, turn.httpError.status, { error: { message: turn.httpError.message } });
      return;
    }
    const id = `chatcmpl-fake-${String(requests.length)}`;
    const model = body.model ?? "fake-model";
    const usage = {
      prompt_tokens: turn.usage?.input ?? 12,
      completion_tokens: turn.usage?.output ?? 7,
      total_tokens: 0,
    };
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    const finish = turn.toolCalls && turn.toolCalls.length > 0 ? "tool_calls" : "stop";

    if (!body.stream) {
      sendJson(res, 200, {
        id,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: turn.text ?? null,
              tool_calls: (turn.toolCalls ?? []).map((c, i) => ({
                id: `call_${String(i)}`,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            },
            finish_reason: finish,
          },
        ],
        usage,
      });
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (delta: Record<string, unknown>, finishReason: string | null, withUsage = false) => {
      const chunk = {
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...(withUsage ? { usage } : {}),
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    };
    const pause = () =>
      turn.chunkDelayMs ? new Promise((r) => setTimeout(r, turn.chunkDelayMs)) : Promise.resolve();

    send({ role: "assistant", content: "" }, null);
    if (turn.reasoning) {
      send({ reasoning_content: turn.reasoning }, null);
      await pause();
    }
    for (const word of splitWords(turn.text ?? "")) {
      send({ content: word }, null);
      await pause();
    }
    (turn.toolCalls ?? []).forEach((c, i) => {
      send(
        {
          tool_calls: [
            {
              index: i,
              id: `call_${String(i)}`,
              type: "function",
              function: { name: c.name, arguments: "" },
            },
          ],
        },
        null,
      );
      const args = JSON.stringify(c.input);
      const half = Math.ceil(args.length / 2);
      send({ tool_calls: [{ index: i, function: { arguments: args.slice(0, half) } }] }, null);
      send({ tool_calls: [{ index: i, function: { arguments: args.slice(half) } }] }, null);
    });
    send({}, finish, true);
    res.write("data: [DONE]\n\n");
    res.end();
  }

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}

function splitWords(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\S+\s*/g)) out.push(m[0]);
  return out;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
