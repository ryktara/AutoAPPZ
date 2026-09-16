import type { z } from "zod";

export type ToolRisk = "read" | "write" | "execute" | "network" | "destructive";

export interface ToolDefinition<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly input: I;
  readonly output: O;
  readonly risk: ToolRisk;
  /** Capability the permission service must grant before execution. */
  readonly capability: string;
}

export interface ToolExecutionContext {
  readonly projectRoot: string;
  readonly signal: AbortSignal;
  readonly taskId: string;
  readonly toolCallId: string;
}

export interface ToolResult<O = unknown> {
  readonly ok: boolean;
  readonly output: O;
  /** Model-facing summary; must already be redacted. */
  readonly summary: string;
  readonly durationMs: number;
}

export interface ToolRuntime {
  list(): readonly ToolDefinition[];
  execute(name: string, input: unknown, ctx: ToolExecutionContext): Promise<ToolResult>;
}
