import BetterSqlite3, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { AppError } from "@autoappz/contracts";
import type { Logger } from "@autoappz/diagnostics";
import { applyMigration, pendingMigrations, type Migration } from "./migration.ts";
import { schema, type Schema } from "./schema.ts";
import { ALL_MIGRATIONS } from "./migrations/index.ts";

export type PlatformDb = BetterSQLite3Database<Schema>;

export interface OpenDatabaseOptions {
  /** File path, or ":memory:" for tests. */
  path: string;
  /** Directory for pre-migration backups; defaults to `<dir of path>/backups`. Ignored for :memory:. */
  backupDir?: string | undefined;
  migrations?: readonly Migration[] | undefined;
  logger?: Logger | undefined;
  now?: (() => number) | undefined;
  /** Absolute path to a better_sqlite3.node built for the current runtime (Electron ABI). */
  nativeBinding?: string | undefined;
}

export interface DatabaseHandle {
  readonly path: string;
  readonly db: PlatformDb;
  readonly sqlite: SqliteDatabase;
  readonly appliedMigrations: readonly string[];
  close(): void;
}

/**
 * Opens the platform database: WAL + foreign keys, backup → migrate → verify.
 * If a migration fails the pre-migration backup is restored and an AppError(precondition) is thrown.
 */
export function openDatabase(options: OpenDatabaseOptions): DatabaseHandle {
  const migrations = options.migrations ?? ALL_MIGRATIONS;
  const now = options.now ?? Date.now;
  const log = options.logger;
  const inMemory = options.path === ":memory:";

  if (!inMemory) mkdirSync(path.dirname(options.path), { recursive: true });
  const existedBefore = !inMemory && existsSync(options.path);

  let sqlite = open(options);
  configure(sqlite);

  const pending = pendingMigrations(sqlite, migrations);
  let backupPath: string | undefined;

  const first = pending[0];
  if (first && existedBefore) {
    backupPath = createBackup(sqlite, options, first.id, now());
    log?.info("database backup created", { backupPath, pending: pending.map((m) => m.id) });
  }

  const applied: string[] = [];
  try {
    for (const m of pending) {
      applyMigration(sqlite, m, now());
      applied.push(m.id);
      log?.info("migration applied", { id: m.id });
    }
    verify(sqlite);
  } catch (error) {
    log?.error("migration failed; restoring backup", {
      failedAfter: applied,
      error: error instanceof Error ? error.message : String(error),
    });
    sqlite.close();
    if (backupPath) restoreBackup(options.path, backupPath);
    throw new AppError("precondition", "storage.migration_failed", "The database could not be upgraded.", {
      details: { applied, backupPath },
      cause: error,
    });
  }

  // Re-open through the same path after migrations so drizzle sees the final schema.
  if (!inMemory) {
    sqlite.close();
    sqlite = open(options);
    configure(sqlite);
  }

  const db = drizzle(sqlite, { schema });
  return {
    path: options.path,
    db,
    sqlite,
    appliedMigrations: applied,
    close() {
      if (sqlite.open) sqlite.close();
    },
  };
}

function open(options: OpenDatabaseOptions): SqliteDatabase {
  return new BetterSqlite3(
    options.path,
    options.nativeBinding ? { nativeBinding: options.nativeBinding } : {},
  );
}

function configure(sqlite: SqliteDatabase): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
}

function verify(sqlite: SqliteDatabase): void {
  const integrity = sqlite.pragma("integrity_check") as { integrity_check: string }[];
  if (integrity[0]?.integrity_check !== "ok") {
    throw new Error(`integrity_check failed: ${JSON.stringify(integrity)}`);
  }
  const fk = sqlite.pragma("foreign_key_check") as unknown[];
  if (fk.length > 0) throw new Error(`foreign_key_check failed: ${JSON.stringify(fk)}`);
}

function createBackup(
  sqlite: SqliteDatabase,
  options: OpenDatabaseOptions,
  firstPendingId: string,
  at: number,
): string {
  const dir = options.backupDir ?? path.join(path.dirname(options.path), "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date(at).toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dir, `${path.basename(options.path, ".db")}-${stamp}-pre-${firstPendingId}.db`);
  // Flush WAL so the file copy is a consistent snapshot, then copy synchronously.
  sqlite.pragma("wal_checkpoint(TRUNCATE)");
  copyFileSync(options.path, dest);
  return dest;
}

function restoreBackup(dbPath: string, backupPath: string): void {
  for (const suffix of ["-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
  const broken = `${dbPath}.broken-${Date.now()}`;
  if (existsSync(dbPath)) renameSync(dbPath, broken);
  copyFileSync(backupPath, dbPath);
}
