// Benchmark runner (docs/performance/BENCHMARKS.md). Run with:
//   node --experimental-transform-types tools/bench/run.mjs [--check] [--out results.json] [--quick]
// Measures indexing, retrieval, search and memory on a synthesized 2k-file app; startup is measured by
// tools/bench/startup.mjs (needs the built desktop bundle). `--check` compares against targets.json and
// baseline.json and exits non-zero on regressions > 10% (CI nightly).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { ProjectIndex, retrieve } from "../../packages/context/src/index.ts";
import { createSearchTool, ReadLedger } from "../../packages/tools/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const quick = args.has("--quick");
const outArg = process.argv.indexOf("--out");
const outFile = outArg >= 0 ? process.argv[outArg + 1] : undefined;

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};
const stats = (values, unit = "ms") => ({
  p50: round(percentile(values, 50)),
  p95: round(percentile(values, 95)),
  n: values.length,
  unit,
});
const round = (n) => Math.round(n * 10) / 10;

/** Synthesizes a realistic 2k-file TypeScript app: modules with imports, components, tests, docs. */
function synthesizeApp(root, files) {
  const perDir = 40;
  const dirs = Math.ceil(files / perDir);
  for (let d = 0; d < dirs; d++) {
    const dir = path.join(root, "src", `feature${String(d)}`);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < perDir && d * perDir + i < files; i++) {
      const n = d * perDir + i;
      const prev =
        n > 0 ? `../feature${String(Math.floor((n - 1) / perDir))}/module${String(n - 1)}` : undefined;
      const body = [
        prev ? `import { compute${String(n - 1)} } from "${prev}.ts";` : "",
        `export interface Record${String(n)} { id: string; name: string; amount: number; createdAt: string; }`,
        `export function compute${String(n)}(records: Record${String(n)}[]): number {`,
        `  return records.reduce((sum, r) => sum + r.amount, 0)${prev ? ` + compute${String(n - 1)}([])` : ""};`,
        "}",
        `export function format${String(n)}(value: number): string {`,
        `  return new Intl.NumberFormat("en-US").format(value);`,
        "}",
        `export const feature${String(n)}Config = { retries: ${String(n % 5)}, timeoutMs: ${String(1000 + n)} };`,
        "",
      ].join("\n");
      writeFileSync(path.join(dir, `module${String(n)}.ts`), body);
      if (n % 4 === 0)
        writeFileSync(
          path.join(dir, `Component${String(n)}.tsx`),
          `import { compute${String(n)} } from "./module${String(n)}.ts";\nexport function Component${String(n)}() {\n  return <div className="feature-${String(n)}">{compute${String(n)}([])}</div>;\n}\n`,
        );
      if (n % 10 === 0)
        writeFileSync(
          path.join(dir, `module${String(n)}.test.ts`),
          `import { compute${String(n)} } from "./module${String(n)}.ts";\ntest("compute${String(n)}", () => { expect(compute${String(n)}([])).toBe(0); });\n`,
        );
    }
  }
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "bench-app", devDependencies: { vite: "5" } }),
  );
  writeFileSync(path.join(root, "README.md"), "# Bench app\n\n## Setup\n\nRun the thing.\n");
}

async function main() {
  const fileCount = quick ? 300 : 2000;
  const root = mkdtempSync(path.join(os.tmpdir(), "autoappz-bench-"));
  const results = {
    meta: {
      platform: `${os.platform()}-${os.arch()}`,
      node: process.version,
      cpus: os.cpus().length,
      files: fileCount,
      at: new Date().toISOString(),
    },
    benchmarks: {},
  };
  try {
    synthesizeApp(root, fileCount);

    // index.cold
    const coldRuns = [];
    for (let i = 0; i < (quick ? 1 : 3); i++) {
      const index = new ProjectIndex({ root, dbFile: ":memory:" });
      const t0 = performance.now();
      await index.fullIndex();
      coldRuns.push(performance.now() - t0);
      if (i < 2) index.close();
      else globalThis.__index = index;
    }
    const index = globalThis.__index ?? new ProjectIndex({ root, dbFile: ":memory:" });
    if (!globalThis.__index) await index.fullIndex();
    results.benchmarks[`index.cold.${quick ? "300" : "2k"}`] = stats(coldRuns);

    // index.incremental: touch a random module, re-index one path
    const incremental = [];
    for (let i = 0; i < (quick ? 10 : 50); i++) {
      const n = (i * 37) % fileCount;
      const file = path.join(root, "src", `feature${String(Math.floor(n / 40))}`, `module${String(n)}.ts`);
      writeFileSync(
        file,
        `${readFileSync(file, "utf8")}\nexport const touched${String(i)} = ${String(i)};\n`,
      );
      const t0 = performance.now();
      index.indexPaths([path.relative(root, file).replace(/\\/g, "/")]);
      incremental.push(performance.now() - t0);
    }
    results.benchmarks[`index.incremental.${quick ? "300" : "2k"}`] = stats(incremental);

    // context.retrieve with a 30k budget
    const queries = Array.from(
      { length: quick ? 10 : 50 },
      (_, i) =>
        `update the amount formatting in feature ${String((i * 91) % fileCount)} and its component so totals show two decimals`,
    );
    const retrieval = [];
    for (const q of queries) {
      const t0 = performance.now();
      retrieve(index, { query: q, phase: "build", budget: { total: 30_000 }, selections: [] });
      retrieval.push(performance.now() - t0);
    }
    results.benchmarks["context.retrieve.30k"] = stats(retrieval);

    // search.text via ripgrep when available
    let rgPath;
    try {
      rgPath = createRequire(path.join(here, "../../packages/tools/package.json"))("@vscode/ripgrep").rgPath;
    } catch {
      rgPath = undefined;
    }
    const search = createSearchTool({ rgPath });
    const searchCtx = {
      projectId: "b",
      projectRoot: root,
      taskId: "t",
      toolCallId: "c",
      signal: new AbortController().signal,
      ledger: new ReadLedger(),
      log: undefined,
    };
    // One warm-up call: the first ripgrep launch pays for binary loading and AV scanning, which is not the steady state.
    await search.execute({ query: "warmup", regex: false, caseSensitive: false, maxResults: 1 }, searchCtx);
    const searches = [];
    for (let i = 0; i < (quick ? 5 : 20); i++) {
      const t0 = performance.now();
      await search.execute(
        {
          query: `compute${String((i * 53) % fileCount)}`,
          regex: false,
          caseSensitive: false,
          maxResults: 100,
        },
        searchCtx,
      );
      searches.push(performance.now() - t0);
    }
    results.benchmarks[rgPath ? "search.ripgrep" : "search.node"] = stats(searches);

    // memory after indexing
    const rss = process.memoryUsage().rss / (1024 * 1024);
    results.benchmarks["memory.rss.afterIndex"] = { p50: round(rss), p95: round(rss), n: 1, unit: "MB" };
    index.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const table = Object.entries(results.benchmarks).map(
    ([name, s]) =>
      `${name.padEnd(28)} p50 ${String(s.p50).padStart(8)} ${s.unit}  p95 ${String(s.p95).padStart(8)} ${s.unit}  (n=${String(s.n)})`,
  );
  console.log(table.join("\n"));
  if (outFile) {
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`written ${outFile}`);
  }
  if (args.has("--check")) {
    const targets = JSON.parse(readFileSync(path.join(here, "targets.json"), "utf8"));
    let baseline = {};
    try {
      baseline = JSON.parse(readFileSync(path.join(here, "baseline.json"), "utf8")).benchmarks ?? {};
    } catch {
      /* no baseline yet */
    }
    const failures = [];
    for (const [name, s] of Object.entries(results.benchmarks)) {
      const target = targets[name];
      if (target && (s.p50 > target.p50 || s.p95 > target.p95))
        failures.push(
          `${name}: p50 ${String(s.p50)} / p95 ${String(s.p95)} exceeds target ${String(target.p50)} / ${String(target.p95)} ${target.unit}`,
        );
      const base = baseline[name];
      if (base && s.p50 > base.p50 * 1.1 && s.p50 - base.p50 > 5)
        failures.push(`${name}: p50 ${String(s.p50)} regressed > 10% vs baseline ${String(base.p50)}`);
    }
    if (failures.length > 0) {
      console.error(`\nBENCH FAILURES\n${failures.join("\n")}`);
      process.exit(1);
    }
    console.log("\nall benchmarks within targets and baseline");
  }
}

await main();
