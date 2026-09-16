import { getTableConfig } from "drizzle-orm/sqlite-core";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "@autoappz/testing";
import {
  ALL_MIGRATIONS,
  SecretRefsRepository,
  SettingsRepository,
  SettingsService,
  openDatabase,
  schema,
  validateMigrationList,
  type Migration,
} from "../src/index.ts";

describe("migrations", () => {
  it("apply cleanly to an empty database and match the drizzle schema exactly", () => {
    const handle = openDatabase({ path: ":memory:" });
    expect(handle.appliedMigrations).toEqual(ALL_MIGRATIONS.map((m) => m.id));

    const tablesInDb = (
      handle.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .filter((n) => n !== "_migrations")
      .sort();
    const tablesInSchema = Object.values(schema)
      .map((t) => getTableConfig(t).name)
      .sort();
    expect(tablesInDb).toEqual(tablesInSchema);

    for (const table of Object.values(schema)) {
      const cfg = getTableConfig(table);
      const cols = (handle.sqlite.pragma(`table_info(${cfg.name})`) as { name: string }[]).map((c) => c.name);
      expect(cols.sort()).toEqual(cfg.columns.map((c) => c.name).sort());
    }
    handle.close();
  });

  it("validates ids and ordering", () => {
    const bad: Migration[] = [
      { id: "0002_b", up: [] },
      { id: "0001_a", up: [] },
    ];
    expect(() => {
      validateMigrationList(bad);
    }).toThrow(/out of order/);
    expect(() => {
      validateMigrationList([{ id: "x", up: [] }]);
    }).toThrow(/Invalid migration id/);
  });

  it("is idempotent across reopen and backs up before applying new migrations", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "autoappz.db");
      const h1 = openDatabase({ path: file });
      new SettingsRepository(h1.db).set("k", { a: 1 });
      h1.close();

      const h2 = openDatabase({ path: file });
      expect(h2.appliedMigrations).toEqual([]);
      expect(new SettingsRepository(h2.db).getRaw("k")).toEqual({ a: 1 });
      h2.close();

      const extra: Migration = { id: "0008_extra", up: ["CREATE TABLE extra (id TEXT PRIMARY KEY)"] };
      const h3 = openDatabase({ path: file, migrations: [...ALL_MIGRATIONS, extra] });
      expect(h3.appliedMigrations).toEqual(["0008_extra"]);
      h3.close();
      const backups = readdirSync(path.join(dir, "backups"));
      expect(backups).toHaveLength(1);
      expect(backups[0]).toMatch(/pre-0008_extra\.db$/);
      await Promise.resolve();
    });
  });

  it("restores the backup when a migration fails", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "autoappz.db");
      openDatabase({ path: file }).close();
      const broken: Migration = { id: "0008_broken", up: ["CREATE TABLE ok (id TEXT)", "THIS IS NOT SQL"] };
      expect(() => openDatabase({ path: file, migrations: [...ALL_MIGRATIONS, broken] })).toThrow(
        /could not be upgraded/,
      );
      // Database is back to the pre-migration state and still opens.
      const h = openDatabase({ path: file });
      const names = h.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='ok'").all().length;
      expect(names).toBe(0);
      h.close();
      expect(existsSync(file)).toBe(true);
      await Promise.resolve();
    });
  });
});

describe("repositories", () => {
  it("settings service validates, merges and notifies", () => {
    const h = openDatabase({ path: ":memory:" });
    const svc = new SettingsService(new SettingsRepository(h.db));
    expect(svc.get().theme).toBe("system");
    const seen: string[] = [];
    svc.onChange((s) => seen.push(s.theme));
    expect(svc.update({ theme: "dark" }).theme).toBe("dark");
    expect(svc.update({ reducedMotion: true })).toMatchObject({ theme: "dark", reducedMotion: true });
    expect(seen).toEqual(["dark", "dark"]);
    expect(() => svc.update({ theme: "neon" as "dark" })).toThrow();
    h.close();
  });

  it("secret refs repository round-trips optional fields", () => {
    const h = openDatabase({ path: ":memory:" });
    const repo = new SecretRefsRepository(h.db);
    repo.insert({ id: "s1", kind: "api-key", label: "OpenAI", createdAt: 1 });
    repo.insert({
      id: "s2",
      kind: "password",
      label: "DB",
      provider: "neon",
      lastFour: "abcd",
      createdAt: 2,
    });
    expect(repo.list()).toEqual([
      { id: "s1", kind: "api-key", label: "OpenAI", createdAt: 1 },
      { id: "s2", kind: "password", label: "DB", provider: "neon", lastFour: "abcd", createdAt: 2 },
    ]);
    repo.update({ id: "s1", kind: "api-key", label: "OpenAI (rotated)", createdAt: 1, rotatedAt: 5 });
    expect(repo.get("s1")?.rotatedAt).toBe(5);
    expect(repo.delete("s1")).toBe(true);
    expect(repo.delete("s1")).toBe(false);
    h.close();
  });
});

describe("usage records", () => {
  it("aggregates per model and filters by task/project", async () => {
    const { UsageRecordsRepository, ProjectsRepository } = await import("../src/index.ts");
    const h = openDatabase({ path: ":memory:" });
    new ProjectsRepository(h.db).insert({
      id: "p1",
      name: "P",
      path: "/x",
      origin: "created",
      runtimeProfile: "host",
      createdAt: 1,
      lastOpenedAt: 1,
    });
    h.sqlite
      .prepare(
        "INSERT INTO tasks (id, project_id, request, complexity, state, created_at, updated_at) VALUES ('t1','p1','r','standard','COMPLETE',1,1)",
      )
      .run();
    const repo = new UsageRecordsRepository(h.db);
    repo.insert({
      id: "u1",
      taskId: "t1",
      providerId: "openai",
      modelId: "gpt-5",
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0.001,
      at: 1,
    });
    repo.insert({
      id: "u2",
      taskId: "t1",
      providerId: "openai",
      modelId: "gpt-5",
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0.001,
      at: 2,
    });
    repo.insert({
      id: "u3",
      taskId: undefined,
      providerId: "ollama",
      modelId: "qwen",
      inputTokens: 10,
      outputTokens: 5,
      estimatedCostUsd: 0,
      at: 3,
    });
    const all = repo.summary();
    expect(all.calls).toBe(3);
    expect(all.estimatedCostUsd).toBe(0.002);
    expect(all.byModel).toHaveLength(2);
    expect(repo.summary({ projectId: "p1" }).calls).toBe(2);
    expect(repo.summary({ taskId: "t1" }).inputTokens).toBe(200);
    expect(repo.summary({ projectId: "nope" }).calls).toBe(0);
    h.close();
  });
});
