import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const INDEX_SCHEMA_VERSION = 1;

/**
 * Per-project index database (`index.db`). Chunks are stored in SQLite and searched with FTS5 (trigram
 * tokenizer so partial identifiers match); symbols and imports feed structural retrieval. Corruption or a
 * version bump drops the file and rebuilds.
 */
export function openIndexDb(file: string): Database.Database {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("temp_store = MEMORY");
    ensureSchema(db);
  } catch (error) {
    // Release the handle before the caller decides to delete and rebuild the file.
    db.close();
    throw error;
  }
  return db;
}

function ensureSchema(db: Database.Database): void {
  const version = db.prepare("PRAGMA user_version").pluck().get() as number;
  if (version === INDEX_SCHEMA_VERSION) return;
  db.exec(`
    DROP TABLE IF EXISTS chunks_fts; DROP TABLE IF EXISTS chunks; DROP TABLE IF EXISTS symbols;
    DROP TABLE IF EXISTS imports; DROP TABLE IF EXISTS diagnostics; DROP TABLE IF EXISTS activity;
    DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS meta;
    CREATE TABLE files (
      path TEXT PRIMARY KEY, language TEXT NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL,
      mtime INTEGER NOT NULL, lines INTEGER NOT NULL, indexed_at INTEGER NOT NULL
    );
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY, path TEXT NOT NULL, kind TEXT NOT NULL, start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL, text TEXT NOT NULL, tokens INTEGER NOT NULL
    );
    CREATE INDEX chunks_path ON chunks(path);
    CREATE VIRTUAL TABLE chunks_fts USING fts5(text, identifiers, path_tokens, tokenize='trigram');
    CREATE TABLE symbols (
      id INTEGER PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
      start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, exported INTEGER NOT NULL,
      container TEXT, signature TEXT NOT NULL
    );
    CREATE INDEX symbols_name ON symbols(name);
    CREATE INDEX symbols_path ON symbols(path);
    CREATE TABLE imports (
      from_path TEXT NOT NULL, specifier TEXT NOT NULL, to_path TEXT, kind TEXT NOT NULL, line INTEGER NOT NULL
    );
    CREATE INDEX imports_from ON imports(from_path);
    CREATE INDEX imports_to ON imports(to_path);
    CREATE TABLE diagnostics (
      path TEXT NOT NULL, line INTEGER, code TEXT, message TEXT NOT NULL, source TEXT NOT NULL, at INTEGER NOT NULL
    );
    CREATE INDEX diagnostics_path ON diagnostics(path);
    CREATE TABLE activity (
      path TEXT NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL, task_id TEXT, at INTEGER NOT NULL
    );
    CREATE INDEX activity_at ON activity(at);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    PRAGMA user_version = ${String(INDEX_SCHEMA_VERSION)};
  `);
}
