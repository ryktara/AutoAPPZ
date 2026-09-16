import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { PlatformDb } from "../database.ts";
import { settings } from "../schema.ts";

/** Key/value JSON store backing user settings and small platform state. */
export class SettingsRepository {
  constructor(
    private readonly db: PlatformDb,
    private readonly now: () => number = Date.now,
  ) {}

  getRaw(key: string): unknown {
    const row = this.db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as unknown;
    } catch {
      return undefined;
    }
  }

  /** Parses through a schema; invalid or missing stored values yield the schema's defaults. */
  get<S extends z.ZodType>(key: string, schema: S): z.output<S> {
    const raw = this.getRaw(key);
    const parsed = schema.safeParse(raw ?? {});
    if (parsed.success) return parsed.data;
    return schema.parse({});
  }

  set(key: string, value: unknown): void {
    const json = JSON.stringify(value);
    this.db
      .insert(settings)
      .values({ key, value: json, updatedAt: this.now() })
      .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: this.now() } })
      .run();
  }

  delete(key: string): void {
    this.db.delete(settings).where(eq(settings.key, key)).run();
  }
}
