# @autoappz/storage

SQLite + Drizzle platform database (ADR-003, `docs/architecture/DATABASE.md`).

- `openDatabase({ path })` — WAL, foreign keys, backup → migrate → verify; restores the backup on failure
- `schema.ts` — Drizzle tables with explicit snake_case columns; `migrations/` — append-only SQL
- `SettingsRepository` / `SettingsService` — validated key/value settings
- `SecretRefsRepository` — secret metadata only; ciphertext lives in `@autoappz/secrets`

`better-sqlite3` v13 ships N-API prebuilds, so the same binary serves Node (tests) and Electron.
