import type { integrations as contracts } from "@autoappz/contracts";

export type DatabaseAdapterId = contracts.DatabaseAdapterId;
export type Integration = contracts.Integration;

/** How to reach a database; the connection string is secret-bearing and never crosses the bus. */
export interface ConnectionTarget {
  readonly connectionString: string;
  readonly ssl: boolean | { rejectUnauthorized: boolean };
  /** Redacted, human-readable description for logs and UI (no password). */
  readonly label: string;
}

export interface DiscoveredInstance {
  readonly id: string;
  readonly name: string;
  readonly region?: string | undefined;
  /** Adapter-specific fields the UI writes into `config` when the user picks this instance. */
  readonly config: Record<string, string>;
  readonly branches?: readonly { id: string; name: string; config: Record<string, string> }[] | undefined;
}

/**
 * One provider family (Postgres, Supabase, Neon). Adapters only derive connection targets and talk to
 * management APIs; SQL always goes through the gateway.
 */
export interface DatabaseAdapter {
  readonly id: DatabaseAdapterId;
  readonly displayName: string;
  /** Which secret the integration needs and how the UI should ask for it. */
  readonly secret: { kind: "password" | "connection-string" | "api-key"; label: string; hint: string };
  readonly configFields: readonly {
    key: string;
    label: string;
    required: boolean;
    placeholder?: string | undefined;
  }[];
  /** Builds the connection target from secret-free config plus the resolved secret. Throws AppError on invalid config. */
  connectionFor(config: Record<string, string>, secret: string | undefined): ConnectionTarget;
  /** Lists instances reachable with an API token (Supabase/Neon); undefined for plain Postgres. */
  discover?(token: string, signal: AbortSignal): Promise<DiscoveredInstance[]>;
}

export interface QueryResult {
  readonly rows: Record<string, unknown>[];
  readonly rowCount: number;
  readonly fields: readonly string[];
  readonly truncated: boolean;
}

/** Minimal executor so the gateway can run over `pg` in production and PGlite/fakes in tests. */
export interface SqlExecutor {
  query(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number; fields: readonly string[] }>;
  close(): Promise<void>;
}

export type SqlExecutorFactory = (target: ConnectionTarget) => SqlExecutor;

export interface ColumnInfo {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly default: string | undefined;
  readonly primaryKey: boolean;
}

export interface ForeignKeyInfo {
  readonly column: string;
  readonly referencesTable: string;
  readonly referencesColumn: string;
}

export interface TableInfo {
  readonly schema: string;
  readonly name: string;
  readonly columns: readonly ColumnInfo[];
  readonly foreignKeys: readonly ForeignKeyInfo[];
  readonly indexes: readonly { name: string; definition: string }[];
  /** Planner estimate, not a count. */
  readonly estimatedRows: number;
}

export interface SchemaSnapshot {
  readonly tables: readonly TableInfo[];
  readonly capturedAt: number;
  readonly serverVersion: string | undefined;
}
