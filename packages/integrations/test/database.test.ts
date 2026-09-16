import { PGlite } from "@electric-sql/pglite";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ProjectDatabase,
  classifySql,
  createDatabaseTools,
  neonAdapter,
  postgresAdapter,
  redactConnectionString,
  renderSchema,
  supabaseAdapter,
  type Integration,
  type SqlExecutor,
} from "../src/index.ts";

describe("classifySql", () => {
  const cases: [string, string][] = [
    ["SELECT * FROM users", "read"],
    ["  select 1;", "read"],
    ["WITH t AS (SELECT 1) SELECT * FROM t", "read"],
    ["EXPLAIN SELECT * FROM users", "read"],
    ["EXPLAIN ANALYZE SELECT 1", "read"],
    ["EXPLAIN ANALYZE DELETE FROM users", "write"],
    ["VALUES (1), (2)", "read"],
    ["SHOW search_path", "read"],
    ["SET search_path TO public", "read"],
    ["BEGIN; SELECT 1; COMMIT", "read"],
    ["INSERT INTO users (name) VALUES ('x')", "write"],
    ["UPDATE users SET name = 'a' WHERE id = 1", "write"],
    ["DELETE FROM users WHERE id = 1", "write"],
    ["WITH d AS (DELETE FROM users WHERE id = 1 RETURNING *) SELECT * FROM d", "write"],
    ["MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET x = 1", "write"],
    ["COPY users FROM STDIN", "write"],
    ["CREATE TABLE t (id int)", "ddl"],
    ["CREATE INDEX idx ON t (id)", "ddl"],
    ["CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql", "ddl"],
    ["ALTER TABLE t ADD COLUMN x int", "ddl"],
    ["ALTER TABLE t RENAME COLUMN a TO b", "ddl"],
    ["GRANT SELECT ON t TO r", "ddl"],
    ["SELECT * INTO new_table FROM users", "ddl"],
    ["UPDATE users SET name = 'a'", "destructive"],
    ["DELETE FROM users", "destructive"],
    ["TRUNCATE users", "destructive"],
    ["DROP TABLE users", "destructive"],
    ["drop schema public cascade", "destructive"],
    ["ALTER TABLE t DROP COLUMN x", "destructive"],
    ["SELECT 1; DROP TABLE users", "destructive"],
    ["SELECT 'DROP TABLE users' AS s", "read"],
    ["-- DELETE FROM users\nSELECT 1", "read"],
    ["SELECT /* TRUNCATE x */ 1", "read"],
    ["DO $$ BEGIN PERFORM 1; END $$", "unknown"],
    ["CALL proc()", "unknown"],
    ["", "unknown"],
  ];
  it.each(cases)("%s → %s", (sql, kind) => {
    expect(classifySql(sql).kind).toBe(kind);
  });
  it("counts statements and explains the worst one", () => {
    const c = classifySql("SELECT 1; UPDATE t SET a = 1 WHERE b = 2; DELETE FROM t");
    expect(c.statements).toBe(3);
    expect(c.kind).toBe("destructive");
    expect(c.reason).toContain("DELETE without WHERE");
  });
});

describe("adapters", () => {
  it("postgres: url secret or host fields + password; redacts labels; rejects bad urls", () => {
    const fromUrl = postgresAdapter.connectionFor(
      {},
      "postgresql://u:p%40ss@db.example.com:5432/app?sslmode=require",
    );
    expect(fromUrl.connectionString).toContain("u:p%40ss@db.example.com");
    expect(fromUrl.label).toBe("postgresql://u:***@db.example.com:5432/app?sslmode=require");
    expect(fromUrl.ssl).toEqual({ rejectUnauthorized: false });
    const fromFields = postgresAdapter.connectionFor(
      { host: "localhost", port: "5433", database: "app", user: "me" },
      "secret",
    );
    expect(fromFields.connectionString).toBe("postgresql://me:secret@localhost:5433/app");
    expect(fromFields.label).not.toContain("secret");
    expect(fromFields.ssl).toBe(false);
    expect(() => postgresAdapter.connectionFor({}, "mysql://x")).toThrow(/postgres/);
    expect(() => postgresAdapter.connectionFor({}, undefined)).toThrow(/secret/);
    expect(redactConnectionString("not a url")).toBe("postgresql://***");
  });

  it("supabase and neon derive TLS connection strings from config + password", () => {
    const s = supabaseAdapter.connectionFor({ projectRef: "abc" }, "pw");
    expect(s.connectionString).toBe("postgresql://postgres:pw@db.abc.supabase.co:5432/postgres");
    expect(s.ssl).toEqual({ rejectUnauthorized: false });
    const n = neonAdapter.connectionFor(
      { projectId: "p", host: "ep-1.eu.aws.neon.tech", database: "neondb", user: "owner" },
      "pw",
    );
    expect(n.connectionString).toBe(
      "postgresql://owner:pw@ep-1.eu.aws.neon.tech:5432/neondb?sslmode=require",
    );
    expect(() => neonAdapter.connectionFor({}, "pw")).toThrow(/host/);
  });

  describe("discovery against mocked management APIs", () => {
    let server: Server;
    let base: string;
    const seen: string[] = [];
    beforeAll(async () => {
      server = createServer((req, res) => {
        seen.push(`${req.headers.authorization ?? ""} ${req.url ?? ""}`);
        res.setHeader("content-type", "application/json");
        if (req.headers.authorization === "Bearer bad") {
          res.statusCode = 401;
          res.end("{}");
        } else if (req.url === "/supabase/v1/projects") {
          res.end(
            JSON.stringify([
              {
                id: "refone",
                name: "Shop",
                region: "eu-west-1",
                database: { host: "db.refone.supabase.co" },
              },
            ]),
          );
        } else if (req.url === "/neon/v2/projects") {
          res.end(
            JSON.stringify({ projects: [{ id: "np", name: "Neon Shop", region_id: "aws-eu-central-1" }] }),
          );
        } else if (req.url === "/neon/v2/projects/np/branches") {
          res.end(JSON.stringify({ branches: [{ id: "br-main", name: "main" }] }));
        } else if (req.url === "/neon/v2/projects/np/endpoints") {
          res.end(
            JSON.stringify({ endpoints: [{ id: "ep", branch_id: "br-main", host: "ep-main.neon.tech" }] }),
          );
        } else {
          res.statusCode = 401;
          res.end("{}");
        }
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const address = server.address();
      base = typeof address === "object" && address ? `http://127.0.0.1:${String(address.port)}` : "";
    });
    afterAll(async () => {
      await new Promise<void>((r) => server.close(() => r()));
    });

    it("lists supabase projects and neon projects with branches, sending the token only as a bearer header", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (input, init) => {
        const url = (typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
          .replace("https://api.supabase.com", `${base}/supabase`)
          .replace("https://console.neon.tech/api", `${base}/neon`);
        return originalFetch(url, init);
      };
      try {
        const signal = new AbortController().signal;
        const supa = await supabaseAdapter.discover!("tok-supa", signal);
        expect(supa).toEqual([
          {
            id: "refone",
            name: "Shop",
            region: "eu-west-1",
            config: {
              projectRef: "refone",
              host: "db.refone.supabase.co",
              database: "postgres",
              user: "postgres",
            },
          },
        ]);
        const neon = await neonAdapter.discover!("tok-neon", signal);
        expect(neon[0]).toMatchObject({ id: "np", name: "Neon Shop", region: "aws-eu-central-1" });
        expect(neon[0]?.branches?.[0]).toEqual({
          id: "br-main",
          name: "main",
          config: { projectId: "np", branchId: "br-main", host: "ep-main.neon.tech" },
        });
        expect(seen.every((s) => s.startsWith("Bearer tok-"))).toBe(true);
        await expect(supabaseAdapter.discover!("bad", signal)).rejects.toMatchObject({
          code: "db.discover_failed",
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

/** PGlite gives a real Postgres dialect in-process; the gateway only needs the executor contract. */
function pgliteExecutor(db: PGlite): SqlExecutor {
  return {
    async query(sql, params) {
      const r = await db.query<Record<string, unknown>>(sql, params ? [...params] : undefined);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length, fields: r.fields.map((f) => f.name) };
    },
    close: () => db.close(),
  };
}

const integration: Integration = {
  id: "int_1",
  projectId: "p1",
  kind: "database",
  adapterId: "postgres",
  name: "local",
  config: {},
  secretId: "sec_1",
  status: "ready",
  updatedAt: 0,
};

describe("ProjectDatabase over PGlite", () => {
  let pglite: PGlite;
  let db: ProjectDatabase;
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(`
      CREATE TABLE users (id serial PRIMARY KEY, email text NOT NULL UNIQUE, created_at timestamptz DEFAULT now());
      CREATE TABLE notes (id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id), body text NOT NULL);
      CREATE INDEX notes_user_idx ON notes(user_id);
      INSERT INTO users (email) VALUES ('a@example.com'), ('b@example.com');
      INSERT INTO notes (user_id, body) VALUES (1, 'hello'), (1, 'world');
    `);
    db = new ProjectDatabase({
      integration,
      adapter: postgresAdapter,
      secret: "postgresql://x:y@localhost/app",
      executorFactory: () => pgliteExecutor(pglite),
      now: () => 42,
    });
  });
  afterAll(async () => {
    await db.close();
  });

  it("tests the connection and introspects tables, keys, foreign keys and indexes", async () => {
    const t = await db.test();
    expect(t.ok).toBe(true);
    const snapshot = await db.introspect();
    expect(snapshot.capturedAt).toBe(42);
    const notes = snapshot.tables.find((x) => x.name === "notes");
    expect(notes?.columns.map((c) => [c.name, c.primaryKey, c.nullable])).toEqual([
      ["id", true, false],
      ["user_id", false, false],
      ["body", false, false],
    ]);
    expect(notes?.foreignKeys).toEqual([
      { column: "user_id", referencesTable: "users", referencesColumn: "id" },
    ]);
    expect(notes?.indexes.map((i) => i.name)).toEqual(
      expect.arrayContaining(["notes_pkey", "notes_user_idx"]),
    );
    const rendered = renderSchema(snapshot);
    expect(rendered).toContain("public.users");
    expect(rendered).toContain("user_id integer not null -> users.id");
  });

  it("executes only allowed classifications, caps rows, and always refuses destructive SQL", async () => {
    const read = await db.execute("SELECT email FROM users ORDER BY id", ["read"]);
    expect(read.rows.map((r) => r["email"])).toEqual(["a@example.com", "b@example.com"]);
    expect(read.classification.kind).toBe("read");
    await expect(
      db.execute("INSERT INTO users (email) VALUES ('c@example.com')", ["read"]),
    ).rejects.toMatchObject({ code: "db.kind_not_allowed" });
    const write = await db.execute("INSERT INTO users (email) VALUES ($1)", ["write"], ["c@example.com"]);
    expect(write.rowCount).toBe(1);
    await expect(db.execute("DELETE FROM users", ["write", "ddl"])).rejects.toMatchObject({
      code: "db.destructive_refused",
    });
    await expect(db.execute("DROP TABLE notes", ["write", "ddl", "read"])).rejects.toMatchObject({
      code: "db.destructive_refused",
    });
    await expect(db.execute("SELECT * FROM nope", ["read"])).rejects.toMatchObject({
      code: "db.query_failed",
    });
    await db.execute("INSERT INTO notes (user_id, body) SELECT 1, 'n' || g FROM generate_series(1, 600) g", [
      "write",
    ]);
    const many = await db.execute("SELECT * FROM notes", ["read"]);
    expect(many.rows).toHaveLength(500);
    expect(many.truncated).toBe(true);
  });

  it("agent tools: schema is read-only, query rejects writes, execute refuses destructive statements", async () => {
    const tools = createDatabaseTools({
      databaseFor: (projectId) => Promise.resolve(projectId === "p1" ? db : undefined),
    });
    expect(tools.map((t) => [t.id, t.permission.capability, t.permission.risk, t.mutates])).toEqual([
      ["db.schema", "db.query", "low", false],
      ["db.query", "db.query", "medium", false],
      ["db.execute", "db.mutate", "high", true],
    ]);
    const ctx = {
      projectId: "p1",
      projectRoot: "/x",
      taskId: "t",
      toolCallId: "c",
      signal: new AbortController().signal,
      ledger: undefined as never,
      log: undefined,
    };
    const schema = await tools[0]!.execute({} as never, ctx);
    expect(schema.ok && schema.summaryForModel).toContain("public.notes");
    const q = await tools[1]!.execute(
      { sql: "SELECT count(*)::int AS n FROM users", maxRows: 5 } as never,
      ctx,
    );
    expect(q.ok && (q.value as { rows: { n: number }[] }).rows[0]?.n).toBe(3);
    const bad = await tools[1]!.execute(
      { sql: "UPDATE users SET email = 'x' WHERE id = 1", maxRows: 5 } as never,
      ctx,
    );
    expect(!bad.ok && bad.error.code).toBe("db.kind_not_allowed");
    const drop = await tools[2]!.execute({ sql: "TRUNCATE notes" } as never, ctx);
    expect(!drop.ok && drop.error.code).toBe("db.destructive_refused");
    const none = await tools[2]!.execute({ sql: "SELECT 1" } as never, { ...ctx, projectId: "other" });
    expect(!none.ok && none.error.code).toBe("db.not_configured");
  });
});

const REAL = process.env["AUTOAPPZ_TEST_DATABASE_URL"];
describe.skipIf(!REAL)("ProjectDatabase against a real PostgreSQL (AUTOAPPZ_TEST_DATABASE_URL)", () => {
  it("connects, reports the server version and introspects", async () => {
    const real = new ProjectDatabase({ integration, adapter: postgresAdapter, secret: REAL });
    try {
      const t = await real.test();
      expect(t).toMatchObject({ ok: true });
      expect(t.ok && t.serverVersion).toMatch(/PostgreSQL/);
      const snapshot = await real.introspect();
      expect(Array.isArray(snapshot.tables)).toBe(true);
    } finally {
      await real.close();
    }
  });
});
