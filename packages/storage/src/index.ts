export interface Migration {
  readonly id: string; // 0001_initial
  readonly up: string; // SQL
}

export interface DatabaseHandle {
  readonly path: string;
  close(): void;
}

export interface DatabaseOpener {
  /** Opens (creating if needed) the platform database at path and applies pending migrations. */
  open(path: string): Promise<DatabaseHandle>;
}

export const PLATFORM_DB_FILENAME = "autoappz.db";
export const PROJECT_INDEX_DB_FILENAME = "index.db";
