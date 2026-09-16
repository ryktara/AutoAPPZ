import pg from "pg";
import { AppError } from "@autoappz/contracts";
import type { Logger } from "@autoappz/diagnostics";
import { classifySql, type SqlClassification, type SqlKind } from "./sql-classifier.ts";
import type {
  ColumnInfo,
  ConnectionTarget,
  DatabaseAdapter,
  ForeignKeyInfo,
  Integration,
  QueryResult,
  SchemaSnapshot,
  SqlExecutor,
  SqlExecutorFactory,
  TableInfo,
} from "./types.ts";

export const MAX_ROWS = 500;
export const STATEMENT_TIMEOUT_MS = 15_000;
const SYSTEM_SCHEMAS = "('pg_catalog', 'information_schema', 'pg_toast')";

/** `pg` pool executor: small pool, connect timeout, per-connection statement timeout. */
export function createPgExecutor(target: ConnectionTarget): SqlExecutor {
  const pool = new pg.Pool({
    connectionString: target.connectionString,
    ssl: target.ssl,
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on("connect", (client) => {
    void client.query(`SET statement_timeout = ${String(STATEMENT_TIMEOUT_MS)}`);
  });
  pool.on("error", () => {
    /* idle client errors surface on the next query */
  });
  return {
    async query(sql, params) {
      const result = await pool.query(sql, params ? [...params] : undefined);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rowCount ?? result.rows.length,
        fields: result.fields.map((f) => f.name),
      };
    },
    close: () => pool.end(),
  };
}

export interface ProjectDatabaseOptions {
  readonly integration: Integration;
  readonly adapter: DatabaseAdapter;
  readonly secret: string | undefined;
  readonly executorFactory?: SqlExecutorFactory | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => number) | undefined;
}

/**
 * One integration's database access: classification-gated execution, bounded results, introspection.
 * SQL text is logged only at debug level; parameters and rows are never logged.
 */
export class ProjectDatabase {
  readonly target: ConnectionTarget;
  private readonly executor: SqlExecutor;
  private readonly log: Logger | undefined;
  private readonly now: () => number;

  constructor(options: ProjectDatabaseOptions) {
    this.target = options.adapter.connectionFor(options.integration.config, options.secret);
    this.executor = (options.executorFactory ?? createPgExecutor)(this.target);
    this.log = options.logger;
    this.now = options.now ?? Date.now;
  }

  async test(): Promise<{ ok: true; serverVersion: string } | { ok: false; message: string }> {
    try {
      const r = await this.executor.query("SELECT version() AS version");
      const version = asText(r.rows[0]?.["version"]) || "unknown";
      return { ok: true, serverVersion: version.split(" on ")[0] ?? version };
    } catch (error) {
      return { ok: false, message: describeError(error) };
    }
  }

  classify(sql: string): SqlClassification {
    return classifySql(sql);
  }

  /**
   * Executes SQL whose classification is in `allowed`; destructive statements are never allowed here
   * (the agent cannot run them; users run those themselves). Rows are capped at MAX_ROWS.
   */
  async execute(
    sql: string,
    allowed: readonly SqlKind[],
    params?: readonly unknown[],
  ): Promise<QueryResult & { classification: SqlClassification }> {
    const classification = classifySql(sql);
    if (classification.kind === "destructive") {
      throw new AppError(
        "permission",
        "db.destructive_refused",
        `Refused: ${classification.reason}. Destructive SQL is never run by the agent; run it yourself if intended.`,
        {
          details: { reason: classification.reason },
        },
      );
    }
    if (!allowed.includes(classification.kind)) {
      throw new AppError(
        "permission",
        "db.kind_not_allowed",
        `This statement is classified as "${classification.kind}" (${classification.reason}) which is not allowed here.`,
        {
          details: { kind: classification.kind },
        },
      );
    }
    this.log?.debug("db execute", { kind: classification.kind, statements: classification.statements });
    let result;
    try {
      result = await this.executor.query(sql, params);
    } catch (error) {
      throw new AppError("external", "db.query_failed", describeError(error));
    }
    const truncated = result.rows.length > MAX_ROWS;
    return {
      rows: truncated ? result.rows.slice(0, MAX_ROWS) : result.rows,
      rowCount: result.rowCount,
      fields: result.fields,
      truncated,
      classification,
    };
  }

  async introspect(): Promise<SchemaSnapshot> {
    const [columns, pks, fks, indexes, estimates, version] = await Promise.all([
      this.executor.query(
        `SELECT c.table_schema AS schema, c.table_name AS name, c.column_name AS col, c.data_type AS type, c.is_nullable AS nullable, c.column_default AS def, c.ordinal_position AS pos
         FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE t.table_type = 'BASE TABLE' AND c.table_schema NOT IN ${SYSTEM_SCHEMAS} ORDER BY 1, 2, 7`,
      ),
      this.executor.query(
        `SELECT tc.table_schema AS schema, tc.table_name AS name, kcu.column_name AS col
         FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY'`,
      ),
      this.executor.query(
        `SELECT tc.table_schema AS schema, tc.table_name AS name, kcu.column_name AS col, ccu.table_name AS ref_table, ccu.column_name AS ref_col
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'`,
      ),
      this.executor.query(
        `SELECT schemaname AS schema, tablename AS name, indexname AS idx, indexdef AS def FROM pg_indexes WHERE schemaname NOT IN ${SYSTEM_SCHEMAS}`,
      ),
      this.executor.query(
        `SELECT n.nspname AS schema, c.relname AS name, c.reltuples::bigint AS rows FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname NOT IN ${SYSTEM_SCHEMAS}`,
      ),
      this.executor
        .query("SELECT version() AS version")
        .catch(() => ({ rows: [] as Record<string, unknown>[], rowCount: 0, fields: [] as string[] })),
    ]);
    const key = (r: Record<string, unknown>) => `${String(r["schema"])}.${String(r["name"])}`;
    const pkSet = new Set(pks.rows.map((r) => `${key(r)}.${String(r["col"])}`));
    const tables = new Map<
      string,
      {
        schema: string;
        name: string;
        columns: ColumnInfo[];
        foreignKeys: ForeignKeyInfo[];
        indexes: { name: string; definition: string }[];
        estimatedRows: number;
      }
    >();
    for (const r of columns.rows) {
      const k = key(r);
      const t = tables.get(k) ?? {
        schema: String(r["schema"]),
        name: String(r["name"]),
        columns: [],
        foreignKeys: [],
        indexes: [],
        estimatedRows: 0,
      };
      t.columns.push({
        name: String(r["col"]),
        type: String(r["type"]),
        nullable: r["nullable"] === "YES",
        default: r["def"] === null || r["def"] === undefined ? undefined : asText(r["def"]),
        primaryKey: pkSet.has(`${k}.${String(r["col"])}`),
      });
      tables.set(k, t);
    }
    for (const r of fks.rows)
      tables.get(key(r))?.foreignKeys.push({
        column: String(r["col"]),
        referencesTable: String(r["ref_table"]),
        referencesColumn: String(r["ref_col"]),
      });
    for (const r of indexes.rows)
      tables.get(key(r))?.indexes.push({ name: String(r["idx"]), definition: String(r["def"]) });
    for (const r of estimates.rows) {
      const t = tables.get(key(r));
      if (t) t.estimatedRows = Math.max(0, Number(r["rows"]));
    }
    const versionText = version.rows[0]?.["version"];
    const out: TableInfo[] = [...tables.values()].sort(
      (a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name),
    );
    return {
      tables: out,
      capturedAt: this.now(),
      serverVersion: versionText === undefined ? undefined : asText(versionText).split(" on ")[0],
    };
  }

  close(): Promise<void> {
    return this.executor.close();
  }
}

/** Renders a snapshot compactly for the model / UI: `schema.table (~rows): col type [pk] [-> ref]`. */
export function renderSchema(snapshot: SchemaSnapshot, maxTables = 60): string {
  const lines: string[] = [];
  for (const t of snapshot.tables.slice(0, maxTables)) {
    lines.push(`${t.schema}.${t.name} (~${String(t.estimatedRows)} rows)`);
    for (const c of t.columns) {
      const fk = t.foreignKeys.find((f) => f.column === c.name);
      lines.push(
        `  ${c.name} ${c.type}${c.nullable ? "" : " not null"}${c.primaryKey ? " [pk]" : ""}${fk ? ` -> ${fk.referencesTable}.${fk.referencesColumn}` : ""}${c.default !== undefined ? ` default ${c.default}` : ""}`,
      );
    }
  }
  if (snapshot.tables.length > maxTables)
    lines.push(`… ${String(snapshot.tables.length - maxTables)} more table(s)`);
  return lines.join("\n");
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    return code ? `${error.message} (${code})` : error.message;
  }
  return String(error);
}

/** Cell values are unknown; render primitives directly and anything else as JSON. */
function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  return JSON.stringify(value);
}
