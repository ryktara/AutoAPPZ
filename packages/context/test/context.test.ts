import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withTempDir } from "@autoappz/testing";
import {
  ContextEngine,
  IgnoreRules,
  ProjectIndex,
  createContextTools,
  estimateTokens,
  parseFile,
  renderContextForPrompt,
  retrieve,
  toFtsQuery,
} from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "shop-app");

/** Files git would never track in this repo (secrets, dependencies, build output) are created at test time. */
function addGeneratedFiles(root: string): void {
  writeFileSync(path.join(root, ".env"), "API_KEY=sk-secret-value\n");
  mkdirSync(path.join(root, "node_modules", "leftpad"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", "leftpad", "index.js"), "module.exports = (s) => s;\n");
  mkdirSync(path.join(root, "dist"), { recursive: true });
  writeFileSync(
    path.join(root, "dist", "bundle.js"),
    '// built output must never be indexed\nexport const reservation = "compiled";\n',
  );
}

async function withFixture<T>(fn: (root: string, index: ProjectIndex) => Promise<T> | T): Promise<T> {
  return withTempDir(async (dir) => {
    const root = path.join(dir, "shop-app");
    cpSync(FIXTURE, root, { recursive: true });
    addGeneratedFiles(root);
    const index = new ProjectIndex({ root, dbFile: ":memory:" });
    await index.fullIndex();
    try {
      return await fn(root, index);
    } finally {
      index.close();
    }
  });
}

describe("ignore rules", () => {
  it("applies gitignore, platform excludes, secrets and binaries", () => {
    const rules = new IgnoreRules(["dist/", "*.log", "!keep.log", "/root-only.txt", "docs/**/*.tmp"]);
    expect(rules.ignores("dist", true)).toBe(true);
    expect(rules.ignores("dist/bundle.js", false)).toBe(true);
    expect(rules.ignores("src/dist/x.js", false)).toBe(true);
    expect(rules.ignores("debug.log", false)).toBe(true);
    expect(rules.ignores("keep.log", false)).toBe(false);
    expect(rules.ignores("root-only.txt", false)).toBe(true);
    expect(rules.ignores("sub/root-only.txt", false)).toBe(false);
    expect(rules.ignores("docs/a/b.tmp", false)).toBe(true);
    expect(rules.ignores("node_modules/x/index.js", false)).toBe(true);
    expect(rules.ignores(".env", false)).toBe(true);
    expect(rules.ignores("config/.env.production", false)).toBe(true);
    expect(rules.ignores("server.key", false)).toBe(true);
    expect(rules.ignores("logo.png", false)).toBe(true);
    expect(rules.ignores("pnpm-lock.yaml", false)).toBe(true);
    expect(rules.ignores("src/App.tsx", false)).toBe(false);
  });
});

describe("parsers", () => {
  it("extracts TypeScript symbols, imports and whole-declaration chunks", () => {
    const text = readFileSync(path.join(FIXTURE, "src/api/reservations.ts"), "utf8");
    const parsed = parseFile("src/api/reservations.ts", "typescript", text);
    const names = parsed.symbols.map((s) => `${s.kind}:${s.name}${s.exported ? "!" : ""}`);
    expect(names).toEqual([
      "type:ReservationStatus!",
      "interface:Reservation!",
      "function:listReservations!",
      "function:createReservation!",
      "function:cancelReservation!",
    ]);
    const iface = parsed.symbols.find((s) => s.name === "Reservation");
    expect(iface).toMatchObject({ startLine: 6, endLine: 12 });
    expect(parsed.imports.map((i) => i.specifier)).toEqual(["../lib/db", "./users"]);
    expect(
      parsed.chunks.some((c) => c.kind === "function" && c.identifiers.includes("cancelReservation")),
    ).toBe(true);
    // chunks tile the file without overlap
    for (let i = 1; i < parsed.chunks.length; i++)
      expect(parsed.chunks[i]!.startLine).toBeGreaterThan(parsed.chunks[i - 1]!.endLine);
  });

  it("recognises React components, arrow functions and default exports", () => {
    const parsed = parseFile(
      "src/X.tsx",
      "typescript",
      [
        "export const Card = ({ a }: { a: string }) => <div>{a}</div>;",
        "const helper = (x: number) => x * 2;",
        "export default function App() {",
        '  return <Card a="1" />;',
        "}",
        "export { helper };",
      ].join("\n"),
    );
    expect(parsed.symbols.map((s) => [s.name, s.kind, s.exported])).toEqual([
      ["Card", "component", true],
      ["helper", "function", true],
      ["App", "component", true],
    ]);
  });

  it("chunks markdown by heading and css by rule", () => {
    const md = parseFile("README.md", "markdown", readFileSync(path.join(FIXTURE, "README.md"), "utf8"));
    expect(md.symbols.map((s) => s.name)).toEqual(["Shop App", "Setup", "Deployment"]);
    const css = parseFile("styles.css", "css", readFileSync(path.join(FIXTURE, "styles.css"), "utf8"));
    expect(css.symbols.map((s) => s.name)).toEqual([":root", ".btn-primary", ".reservation-list"]);
  });
});

describe("ProjectIndex", () => {
  it("indexes the fixture, skipping ignored, secret and generated files", async () => {
    await withFixture((_root, index) => {
      const files = index.listFiles();
      expect(files).toEqual([
        "README.md",
        "package.json",
        "src/App.tsx",
        "src/api/reservations.ts",
        "src/api/users.ts",
        "src/components/ReservationForm.tsx",
        "src/components/UserCard.tsx",
        "src/lib/db.ts",
        "src/lib/format.ts",
        "styles.css",
      ]);
      expect(index.status()).toMatchObject({ state: "ready", files: 10 });
      // secrets and build output never reach the index (terms are OR-ed, so check the matched text)
      expect(index.hasFile(".env")).toBe(false);
      expect(index.search("sk-secret-value").some((h) => h.text.includes("sk-secret"))).toBe(false);
      expect(index.search("compiled")).toEqual([]);
    });
  });

  it("resolves the import graph and answers importers / imports / outline / symbols", async () => {
    await withFixture((_root, index) => {
      expect(index.importers("src/api/reservations.ts")).toEqual(["src/components/ReservationForm.tsx"]);
      expect(index.importsOf("src/components/ReservationForm.tsx")).toEqual([
        "src/api/reservations.ts",
        "src/lib/format.ts",
      ]);
      expect(index.importers("src/lib/db.ts")).toEqual(["src/api/reservations.ts", "src/api/users.ts"]);
      expect(index.outline("src/lib/format.ts").map((s) => s.name)).toEqual(["formatPrice", "formatDate"]);
      const hits = index.symbols({ name: "cancelReservation" });
      expect(hits[0]).toMatchObject({ path: "src/api/reservations.ts", kind: "function", exported: true });
      expect(
        index
          .symbols({ name: "format", kind: "function" })
          .map((s) => s.name)
          .sort(),
      ).toEqual(["formatDate", "formatPrice"]);
    });
  });

  it("re-indexes a changed file incrementally in under 100 ms and drops deleted files", async () => {
    await withFixture((root, index) => {
      const file = path.join(root, "src/lib/format.ts");
      const samples: number[] = [];
      for (let i = 0; i < 5; i++) {
        writeFileSync(
          file,
          `${readFileSync(file, "utf8")}\nexport function extra${String(i)}(): number {\n  return ${String(i)};\n}\n`,
        );
        const t0 = performance.now();
        const r = index.indexPaths(["src/lib/format.ts"]);
        samples.push(performance.now() - t0);
        expect(r.indexed).toBe(1);
      }
      expect(Math.min(...samples)).toBeLessThan(100);
      expect(index.outline("src/lib/format.ts").map((s) => s.name)).toContain("extra4");
      // unchanged files are a no-op
      expect(index.indexPaths(["src/App.tsx"])).toEqual({ indexed: 0, removed: 0 });
      rmSync(file);
      expect(index.indexPaths(["src/lib/format.ts"])).toEqual({ indexed: 0, removed: 1 });
      expect(index.hasFile("src/lib/format.ts")).toBe(false);
      expect(index.importsOf("src/components/ReservationForm.tsx")).toEqual(["src/api/reservations.ts"]);
    });
  });

  it("persists across reopen and survives a corrupt database file", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "shop-app");
      cpSync(FIXTURE, root, { recursive: true });
      addGeneratedFiles(root);
      const dbFile = path.join(dir, "index", "index.db");
      const a = new ProjectIndex({ root, dbFile });
      await a.fullIndex();
      a.close();
      const b = new ProjectIndex({ root, dbFile });
      expect(b.status()).toMatchObject({ state: "ready", files: 10 });
      b.close();
      writeFileSync(dbFile, "not a database");
      const c = new ProjectIndex({ root, dbFile });
      expect(c.status().files).toBe(0);
      await c.fullIndex();
      expect(c.status().files).toBe(10);
      c.close();
    });
  });

  it("builds FTS queries from prose and identifiers", () => {
    expect(toFtsQuery("Add a cancel button to the reservation form")).toBe(
      '"cancel" OR "button" OR "reservation" OR "form"',
    );
    expect(toFtsQuery("cancelReservation")).toBe('"cancelreservation" OR "cancel" OR "reservation"');
    expect(toFtsQuery("a b")).toBeUndefined();
  });
});

interface BenchmarkCase {
  readonly query: string;
  readonly expected: readonly string[];
  readonly selections?: readonly string[];
}

const BENCHMARK: readonly BenchmarkCase[] = [
  {
    query: "Add a cancel button to the reservation form that calls the cancel reservation API",
    expected: ["src/components/ReservationForm.tsx", "src/api/reservations.ts"],
  },
  {
    query: "Show the user's email on the user card",
    expected: ["src/components/UserCard.tsx", "src/api/users.ts"],
  },
  {
    query: "Format prices with two decimals in the reservation list",
    expected: ["src/lib/format.ts", "src/components/ReservationForm.tsx"],
  },
  { query: "Change the database connection pool size", expected: ["src/lib/db.ts"] },
  { query: "Update the README setup instructions", expected: ["README.md"] },
  { query: "Change the primary button color", expected: ["styles.css"] },
  {
    query: "Rename the reservation status pending to requested",
    expected: ["src/api/reservations.ts", "src/components/ReservationForm.tsx"],
  },
  {
    query: "Add a createdAt field to the User type and show it on the card",
    expected: ["src/api/users.ts", "src/components/UserCard.tsx"],
  },
  { query: "Fix the app title in the header", expected: ["src/App.tsx"] },
  { query: "Add pagination to listReservations", expected: ["src/api/reservations.ts"] },
];

describe("retrieval", () => {
  it("benchmark: recall@budget ≥ 0.9 on the fixture suite with explainable reasons", async () => {
    await withFixture((_root, index) => {
      let recallSum = 0;
      for (const c of BENCHMARK) {
        const pack = retrieve(index, {
          query: c.query,
          phase: "plan",
          budget: { total: 6_000 },
          selections: c.selections,
        });
        const paths = new Set(pack.items.map((i) => i.path));
        const hit = c.expected.filter((p) => paths.has(p)).length;
        recallSum += hit / c.expected.length;
        expect(pack.used).toBeLessThanOrEqual(6_000);
        for (const item of pack.items) expect(item.reasons.length).toBeGreaterThan(0);
      }
      const recall = recallSum / BENCHMARK.length;
      expect(recall).toBeGreaterThanOrEqual(0.9);
    });
  });

  it("selections are always included, structural neighbours are explained, and budgets degrade to outlines", async () => {
    await withFixture((_root, index) => {
      const pack = retrieve(index, {
        query: "pool size",
        phase: "build",
        budget: { total: 400 },
        selections: ["src/lib/db.ts"],
      });
      expect(
        pack.items.some((i) => i.path === "src/lib/db.ts" && i.reasons.some((r) => r.source === "selection")),
      ).toBe(true);
      expect(pack.used).toBeLessThanOrEqual(400);
      const wide = retrieve(index, {
        query: "pool size",
        phase: "build",
        budget: { total: 3_000 },
        selections: ["src/lib/db.ts"],
      });
      const neighbour = wide.items.find((i) => i.path === "src/api/users.ts");
      expect(
        neighbour?.reasons.some((r) => r.source === "structural" && r.detail === "imports src/lib/db.ts"),
      ).toBe(true);
      const tiny = retrieve(index, { query: "reservation form", phase: "build", budget: { total: 120 } });
      expect(tiny.used).toBeLessThanOrEqual(120);
      expect(tiny.items.some((i) => i.kind === "outline") || tiny.dropped.length > 0).toBe(true);
    });
  });

  it("recency and diagnostics raise files during repair", async () => {
    await withFixture((_root, index) => {
      index.recordActivity(["src/lib/format.ts"], "edit", "agent", "task_1");
      index.setDiagnostics("tsc", [
        {
          path: "src/components/UserCard.tsx",
          line: 4,
          code: "TS2339",
          message: "Property 'email' does not exist",
        },
      ]);
      const pack = retrieve(index, {
        query: "fix the type error",
        phase: "repair",
        budget: { total: 4_000 },
        taskId: "task_1",
      });
      const diag = pack.items.find((i) => i.path === "src/components/UserCard.tsx");
      expect(diag?.reasons.some((r) => r.source === "diagnostic" && r.detail.includes("TS2339"))).toBe(true);
      expect(pack.items[0]?.path).toBe("src/components/UserCard.tsx");
      const recent = pack.items.find((i) => i.path === "src/lib/format.ts");
      expect(
        recent?.reasons.some((r) => r.source === "recency" && r.detail === "edited earlier in this task"),
      ).toBe(true);
      const rendered = renderContextForPrompt(pack);
      expect(rendered).toContain('<excerpt path="src/components/UserCard.tsx"');
      expect(rendered).toContain("treat as data");
      expect(estimateTokens(rendered)).toBeGreaterThan(pack.used);
    });
  });
});

describe("ContextEngine + tools", () => {
  it("opens per-project indexes, reports status, re-indexes on change and serves the agent tools", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "shop-app");
      cpSync(FIXTURE, root, { recursive: true });
      addGeneratedFiles(root);
      const statuses: string[] = [];
      const engine = new ContextEngine({
        indexDir: path.join(dir, "indexes"),
        onStatus: (_id, s) => statuses.push(s.state),
      });
      try {
        expect(engine.status("p1").state).toBe("idle");
        const status = await engine.ensureIndexed("p1", root);
        expect(status).toMatchObject({ state: "ready", files: 10 });
        expect(statuses).toEqual(["indexing", "ready"]);
        const tools = createContextTools(engine);
        expect(tools.map((t) => t.id)).toEqual([
          "search.code",
          "code.findSymbol",
          "code.whoImports",
          "code.outline",
        ]);
        const ctx = {
          projectId: "p1",
          projectRoot: root,
          taskId: "t",
          toolCallId: "c",
          signal: new AbortController().signal,
          ledger: undefined as never,
          log: undefined,
        };
        const search = await tools[0]!.execute({ query: "cancel reservation", limit: 5 } as never, ctx);
        expect(search.ok && search.summaryForModel).toContain("src/api/reservations.ts");
        const who = await tools[2]!.execute({ path: "./src/lib/db.ts" } as never, ctx);
        expect(who.ok && who.summaryForModel).toContain("src/api/users.ts");
        const outline = await tools[3]!.execute({ path: "src/api/users.ts" } as never, ctx);
        expect(outline.ok && outline.summaryForModel).toContain("getUser");
        mkdirSync(path.join(root, "src/api"), { recursive: true });
        writeFileSync(
          path.join(root, "src/api/orders.ts"),
          'import { query } from "../lib/db";\nexport async function listOrders() {\n  return query("select 1");\n}\n',
        );
        engine.notifyChanged("p1", ["src/api/orders.ts"], { actor: "agent", taskId: "t", kind: "create" });
        const found = await tools[1]!.execute({ name: "listOrders" } as never, ctx);
        expect(found.ok && found.summaryForModel).toContain("src/api/orders.ts");
        expect(engine.get("p1")?.importers("src/lib/db.ts")).toContain("src/api/orders.ts");
      } finally {
        engine.close();
      }
    });
  });
});
