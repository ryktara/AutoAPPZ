import type { Database as SqliteDatabase } from "better-sqlite3";

export interface Migration {
  /** Sortable, unique, e.g. "0001_initial". Never renamed once shipped. */
  readonly id: string;
  /** Statements executed in order inside one transaction. */
  readonly up: readonly string[];
}

const MIGRATIONS_TABLE = "_migrations";
const ID_PATTERN = /^\d{4}_[a-z0-9_]+$/;

export function ensureMigrationsTable(sqlite: SqliteDatabase): void {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (id TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)`,
  );
}

export function appliedMigrationIds(sqlite: SqliteDatabase): string[] {
  ensureMigrationsTable(sqlite);
  const rows = sqlite.prepare(`SELECT id FROM ${MIGRATIONS_TABLE} ORDER BY id`).all() as { id: string }[];
  return rows.map((r) => r.id);
}

export function pendingMigrations(sqlite: SqliteDatabase, migrations: readonly Migration[]): Migration[] {
  validateMigrationList(migrations);
  const applied = new Set(appliedMigrationIds(sqlite));
  return migrations.filter((m) => !applied.has(m.id));
}

export function validateMigrationList(migrations: readonly Migration[]): void {
  const seen = new Set<string>();
  let previous = "";
  for (const m of migrations) {
    if (!ID_PATTERN.test(m.id)) throw new Error(`Invalid migration id "${m.id}"`);
    if (seen.has(m.id)) throw new Error(`Duplicate migration id "${m.id}"`);
    if (m.id <= previous) throw new Error(`Migrations out of order at "${m.id}"`);
    seen.add(m.id);
    previous = m.id;
  }
}

/** Applies one migration atomically and records it. Throws on failure with the transaction rolled back. */
export function applyMigration(sqlite: SqliteDatabase, migration: Migration, now: number): void {
  const run = sqlite.transaction(() => {
    for (const statement of migration.up) sqlite.exec(statement);
    sqlite.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, ?)`).run(migration.id, now);
  });
  run();
}
