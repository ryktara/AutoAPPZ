import { z } from "zod";
import { AppError } from "@autoappz/contracts";
import type { AgentTool, AnyTool, ToolResult } from "@autoappz/tools";
import { renderSchema, type ProjectDatabase } from "./gateway.ts";

const SchemaInput = z.object({});
const SchemaOutput = z.object({ tables: z.number().int().nonnegative(), schema: z.string() });
const QueryInput = z.object({
  sql: z
    .string()
    .min(1)
    .max(20_000)
    .describe("A single read-only statement (SELECT / WITH … SELECT / EXPLAIN)."),
  params: z
    .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .max(50)
    .optional(),
  maxRows: z.number().int().min(1).max(200).default(50),
});
const QueryOutput = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z.number().int(),
  fields: z.array(z.string()),
  truncated: z.boolean(),
});
const ExecuteInput = z.object({
  sql: z
    .string()
    .min(1)
    .max(20_000)
    .describe("INSERT/UPDATE/DELETE with WHERE, or CREATE/ALTER (non-destructive) statements."),
  params: z
    .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .max(50)
    .optional(),
});
const ExecuteOutput = z.object({ rowCount: z.number().int(), kind: z.string() });

type SchemaIn = z.infer<typeof SchemaInput>;
type SchemaOut = z.infer<typeof SchemaOutput>;
type QueryIn = z.infer<typeof QueryInput>;
type QueryOut = z.infer<typeof QueryOutput>;
type ExecuteIn = z.infer<typeof ExecuteInput>;
type ExecuteOut = z.infer<typeof ExecuteOutput>;

export interface DatabaseToolsOptions {
  /** Resolves the project's attached database; undefined when none is configured. */
  databaseFor(projectId: string): Promise<ProjectDatabase | undefined>;
}

function noDatabase<T>(): ToolResult<T> {
  return {
    ok: false,
    error: {
      code: "db.not_configured",
      message: "No database is attached to this project. Configure one in the Project tab → Database.",
    },
    summaryForModel: "No database is attached to this project.",
  };
}

function failure<T>(error: unknown): ToolResult<T> {
  const e =
    error instanceof AppError
      ? error
      : new AppError("external", "db.error", error instanceof Error ? error.message : String(error));
  return { ok: false, error: { code: e.code, message: e.message }, summaryForModel: e.message };
}

/** Agent tools over the project's attached database: schema (read), query (read-only), execute (write/ddl; never destructive). */
export function createDatabaseTools(options: DatabaseToolsOptions): AnyTool[] {
  const schema: AgentTool<SchemaIn, SchemaOut> = {
    id: "db.schema",
    description: "Describe the attached database: tables, columns, keys and approximate row counts.",
    inputSchema: SchemaInput,
    outputSchema: SchemaOutput,
    permission: {
      capability: "db.query",
      risk: "low",
      scope: () => "schema",
      defaultPolicy: "allow",
      describe: () => "Read the database schema",
    },
    timeoutMs: 30_000,
    mutates: false,
    async execute(_input, ctx) {
      const db = await options.databaseFor(ctx.projectId);
      if (!db) return noDatabase();
      try {
        const snapshot = await db.introspect();
        const text = renderSchema(snapshot);
        return {
          ok: true,
          value: { tables: snapshot.tables.length, schema: text },
          summaryForModel: text || "(no user tables)",
        };
      } catch (error) {
        return failure(error);
      }
    },
  };

  const query: AgentTool<QueryIn, QueryOut> = {
    id: "db.query",
    description:
      "Run a read-only SQL query against the attached database. Rows are capped; never use for writes.",
    inputSchema: QueryInput,
    outputSchema: QueryOutput,
    permission: {
      capability: "db.query",
      risk: "medium",
      scope: () => "rows",
      defaultPolicy: "ask",
      describe: (i) => `Read data: ${i.sql.slice(0, 80)}`,
    },
    timeoutMs: 30_000,
    mutates: false,
    async execute(input, ctx) {
      const db = await options.databaseFor(ctx.projectId);
      if (!db) return noDatabase();
      try {
        const r = await db.execute(input.sql, ["read"], input.params);
        const rows = r.rows.slice(0, input.maxRows);
        const truncated = r.truncated || rows.length < r.rows.length;
        const summary =
          rows.length === 0
            ? "No rows."
            : `${String(r.rowCount)} row(s)${truncated ? " (truncated)" : ""}\n${JSON.stringify(rows).slice(0, 6_000)}`;
        return {
          ok: true,
          value: { rows, rowCount: r.rowCount, fields: [...r.fields], truncated },
          summaryForModel: summary,
        };
      } catch (error) {
        return failure(error);
      }
    },
  };

  const execute: AgentTool<ExecuteIn, ExecuteOut> = {
    id: "db.execute",
    description:
      "Run a data-modifying or schema statement. Destructive statements (DROP, TRUNCATE, DELETE/UPDATE without WHERE, ALTER … DROP) are always refused.",
    inputSchema: ExecuteInput,
    outputSchema: ExecuteOutput,
    permission: {
      capability: "db.mutate",
      risk: "high",
      scope: () => "*",
      defaultPolicy: "ask",
      describe: (i) => `Modify the database: ${i.sql.slice(0, 80)}`,
    },
    timeoutMs: 60_000,
    mutates: true,
    async execute(input, ctx) {
      const db = await options.databaseFor(ctx.projectId);
      if (!db) return noDatabase();
      try {
        const r = await db.execute(input.sql, ["write", "ddl", "read"], input.params);
        return {
          ok: true,
          value: { rowCount: r.rowCount, kind: r.classification.kind },
          summaryForModel: `${r.classification.kind}: ${String(r.rowCount)} row(s) affected`,
        };
      } catch (error) {
        return failure(error);
      }
    },
  };

  return [schema, query, execute];
}
