import { z } from "zod";
import { AppError, type permissions as contracts } from "@autoappz/contracts";
import type { Logger, Redactor } from "@autoappz/diagnostics";
import type { PermissionEngine } from "@autoappz/permissions";
import type { ReadLedger } from "./read-ledger.ts";

export interface PermissionDescriptor<I> {
  readonly capability: contracts.Capability;
  readonly risk: contracts.RiskTier;
  /** Concrete scope for the policy engine, derived from validated input. */
  readonly scope: (input: I) => string;
  readonly defaultPolicy: "allow" | "ask" | "deny";
  /** Human sentence describing the effect, shown on the consent sheet. */
  readonly describe: (input: I) => string;
}

export interface ToolContext {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly taskId: string;
  readonly agentRunId?: string | undefined;
  readonly toolCallId: string;
  readonly signal: AbortSignal;
  readonly ledger: ReadLedger;
  readonly log: Logger | undefined;
}

export type ToolResult<O> =
  | { readonly ok: true; readonly value: O; readonly summaryForModel: string }
  | {
      readonly ok: false;
      readonly error: { code: string; message: string; details?: Record<string, unknown> | undefined };
      readonly summaryForModel: string;
    };

export interface AgentTool<I, O> {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<I>;
  readonly outputSchema: z.ZodType<O>;
  readonly permission: PermissionDescriptor<I>;
  readonly timeoutMs: number;
  /** Read-only tools may run in parallel; writes are serialised per project. */
  readonly mutates: boolean;
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
}

/** Structural view over any tool; parameter positions use `never` so concrete tools assign without casts. */
export interface SchemaLike {
  safeParse(input: unknown): z.ZodSafeParseResult<unknown>;
}
export interface AnyTool {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: SchemaLike;
  readonly outputSchema: SchemaLike;
  readonly permission: PermissionDescriptor<never>;
  readonly timeoutMs: number;
  readonly mutates: boolean;
  execute(input: never, ctx: ToolContext): Promise<ToolResult<unknown>>;
}

export interface AuditSink {
  record(entry: contracts.ToolCallAudit): void;
}

export interface ToolRuntimeOptions {
  tools: readonly AnyTool[];
  permissions: PermissionEngine;
  audit: AuditSink;
  redactor: Redactor;
  logger?: Logger | undefined;
  now?: (() => number) | undefined;
  newId?: (() => string) | undefined;
  /** Upper bound for `summaryForModel` (characters). */
  maxSummaryChars?: number | undefined;
}

export interface ExecuteInput {
  readonly toolId: string;
  readonly input: unknown;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly taskId: string;
  readonly agentRunId?: string | undefined;
  readonly signal: AbortSignal;
  readonly ledger: ReadLedger;
}

/**
 * Pipeline per call: validate input → resolve scope → policy decision (may park for consent) →
 * audit → execute with timeout + signal → bound output → audit. Nothing executes without an audit row.
 */
export class ToolRuntime {
  private readonly tools = new Map<string, AnyTool>();
  private readonly writeQueues = new Map<string, Promise<unknown>>();
  private readonly o: ToolRuntimeOptions;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly maxSummary: number;

  constructor(options: ToolRuntimeOptions) {
    this.o = options;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? defaultId;
    this.maxSummary = options.maxSummaryChars ?? 8_000;
    for (const t of options.tools) {
      if (this.tools.has(t.id)) throw new Error(`Duplicate tool id ${t.id}`);
      this.tools.set(t.id, t);
    }
  }

  list(): AnyTool[] {
    return [...this.tools.values()];
  }

  get(id: string): AnyTool | undefined {
    return this.tools.get(id);
  }

  /** Tool specs in the shape the model provider expects (JSON Schema inputs). */
  specs(): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
    return this.list().map((t) => ({
      name: t.id,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    }));
  }

  async execute(call: ExecuteInput): Promise<ToolResult<unknown>> {
    const startedAt = this.now();
    const tool = this.tools.get(call.toolId);
    const toolCallId = this.newId();
    if (call.signal.aborted) {
      return {
        ok: false,
        error: { code: "tool.cancelled", message: "Cancelled" },
        summaryForModel: `${call.toolId} was cancelled.`,
      };
    }
    if (!tool) {
      return {
        ok: false,
        error: { code: "tool.unknown", message: `Unknown tool "${call.toolId}"` },
        summaryForModel: `Unknown tool "${call.toolId}".`,
      };
    }
    const parsed = tool.inputSchema.safeParse(call.input);
    if (!parsed.success) {
      const result: ToolResult<unknown> = {
        ok: false,
        error: {
          code: "tool.invalid_input",
          message: "Invalid tool input",
          details: { issues: parsed.error.issues.slice(0, 10) },
        },
        summaryForModel: `Invalid input for ${tool.id}: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .slice(0, 5)
          .join("; ")}`,
      };
      this.audit(
        call,
        tool,
        toolCallId,
        "<invalid>",
        { decision: "deny", source: "default" },
        result,
        startedAt,
      );
      return result;
    }
    const input = parsed.data as never;
    const scope = tool.permission.scope(input);
    const decision = await this.o.permissions.check({
      projectId: call.projectId,
      taskId: call.taskId,
      toolId: tool.id,
      capability: tool.permission.capability,
      scope,
      risk: tool.permission.risk,
      defaultPolicy: tool.permission.defaultPolicy,
      description: tool.permission.describe(input),
      signal: call.signal,
    });
    if (decision.decision === "deny") {
      const why =
        decision.source === "timeout"
          ? "the user did not respond in time"
          : decision.source === "cancelled"
            ? "the task was cancelled"
            : "permission was denied";
      const result: ToolResult<unknown> = {
        ok: false,
        error: { code: `tool.denied.${decision.source}`, message: `Not allowed: ${why}.` },
        summaryForModel: `${tool.id} on ${scope} was not allowed (${why}). Do not retry the same action; ask the user or choose another approach.`,
      };
      this.audit(call, tool, toolCallId, scope, decision, result, startedAt);
      return result;
    }

    const ctx: ToolContext = {
      projectId: call.projectId,
      projectRoot: call.projectRoot,
      taskId: call.taskId,
      agentRunId: call.agentRunId,
      toolCallId,
      signal: call.signal,
      ledger: call.ledger,
      log: this.o.logger,
    };
    const run = () => this.runWithTimeout(tool, input, ctx);
    let result: ToolResult<unknown>;
    if (tool.mutates) {
      const prev = this.writeQueues.get(call.projectId) ?? Promise.resolve();
      const next = prev.then(run, run);
      this.writeQueues.set(
        call.projectId,
        next.catch(() => undefined),
      );
      result = await next;
    } else {
      result = await run();
    }
    result = this.bound(result);
    this.audit(call, tool, toolCallId, scope, decision, result, startedAt);
    return result;
  }

  private async runWithTimeout(tool: AnyTool, input: never, ctx: ToolContext): Promise<ToolResult<unknown>> {
    const timeout = new Promise<ToolResult<unknown>>((resolve) => {
      const t = setTimeout(() => {
        resolve({
          ok: false,
          error: { code: "tool.timeout", message: `${tool.id} timed out after ${String(tool.timeoutMs)} ms` },
          summaryForModel: `${tool.id} timed out.`,
        });
      }, tool.timeoutMs);
      ctx.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve({
            ok: false,
            error: { code: "tool.cancelled", message: "Cancelled" },
            summaryForModel: `${tool.id} was cancelled.`,
          });
        },
        { once: true },
      );
    });
    try {
      if (ctx.signal.aborted) return await timeout;
      const result = await Promise.race([tool.execute(input, ctx), timeout]);
      if (result.ok) {
        const out = tool.outputSchema.safeParse(result.value);
        if (!out.success) {
          return {
            ok: false,
            error: { code: "tool.invalid_output", message: "Tool produced invalid output" },
            summaryForModel: `${tool.id} produced invalid output.`,
          };
        }
      }
      return result;
    } catch (error) {
      const app = AppError.from(error);
      return {
        ok: false,
        error: { code: app.code, message: app.message, details: app.details },
        summaryForModel: `${tool.id} failed: ${app.message}`,
      };
    }
  }

  private bound(result: ToolResult<unknown>): ToolResult<unknown> {
    const summary = this.o.redactor.redactString(result.summaryForModel);
    const cut =
      summary.length > this.maxSummary
        ? `${summary.slice(0, this.maxSummary)}\n…[truncated ${String(summary.length - this.maxSummary)} chars]`
        : summary;
    return { ...result, summaryForModel: cut };
  }

  private audit(
    call: ExecuteInput,
    tool: AnyTool,
    toolCallId: string,
    scope: string,
    decision: { decision: "allow" | "deny"; source: contracts.DecisionSource },
    result: ToolResult<unknown>,
    startedAt: number,
  ): void {
    const entry: contracts.ToolCallAudit = {
      id: toolCallId,
      taskId: call.taskId,
      toolId: tool.id,
      capability: tool.permission.capability,
      scope: scope || "-",
      decision: decision.decision,
      decisionSource: decision.source,
      inputRedacted: this.o.redactor.redact(call.input),
      ok: result.ok,
      resultSummary: result.ok
        ? result.summaryForModel.slice(0, 500)
        : `${result.error.code}: ${result.error.message}`.slice(0, 500),
      durationMs: Math.max(0, this.now() - startedAt),
      at: startedAt,
    };
    if (call.agentRunId !== undefined) entry.agentRunId = call.agentRunId;
    try {
      this.o.audit.record(entry);
    } catch (error) {
      this.o.logger?.error("audit write failed", {
        toolId: tool.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** JSON Schema for a tool input (zod v4 `toJSONSchema`), used for the model's tool declarations. */
export function zodToJsonSchema(schema: SchemaLike): Record<string, unknown> {
  if (schema instanceof z.ZodType) return z.toJSONSchema(schema, { io: "input" });
  return { type: "object" };
}

function defaultId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = "call_";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
