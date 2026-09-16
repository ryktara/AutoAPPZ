// Startup-to-interactive benchmark: launches the built desktop app N times and measures the time from
// process launch until the renderer reports the workspace ready (window title + status text).
//   node tools/bench/startup.mjs [--runs 10] [--out results-startup.json]
// Requires `pnpm --filter @autoappz/desktop build` and the Playwright Electron driver (tests/e2e deps).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../tests/e2e/package.json"));
const { _electron: electron } = require("@playwright/test");
const appDir = path.resolve(here, "../../apps/desktop");
const runsArg = process.argv.indexOf("--runs");
const runs = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 10;
const outArg = process.argv.indexOf("--out");
const outFile = outArg >= 0 ? process.argv[outArg + 1] : undefined;

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};

async function measure(dataDir) {
  const t0 = performance.now();
  const app = await electron.launch({
    args: [appDir],
    env: { ...process.env, AUTOAPPZ_DATA_DIR: dataDir, AUTOAPPZ_LOG_LEVEL: "warn" },
  });
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("status").filter({ hasText: "Workspace ready" }).waitFor({ timeout: 30_000 });
  const elapsed = performance.now() - t0;
  await app.close();
  return elapsed;
}

const dir = mkdtempSync(path.join(os.tmpdir(), "autoappz-bench-startup-"));
const cold = [];
const warm = [];
try {
  for (let i = 0; i < runs; i++) cold.push(await measure(mkdtempSync(path.join(dir, "cold-"))));
  const warmDir = mkdtempSync(path.join(dir, "warm-"));
  await measure(warmDir);
  for (let i = 0; i < runs; i++) warm.push(await measure(warmDir));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const results = {
  meta: { platform: `${os.platform()}-${os.arch()}`, runs, at: new Date().toISOString() },
  benchmarks: {
    "startup.cold": {
      p50: Math.round(percentile(cold, 50)),
      p95: Math.round(percentile(cold, 95)),
      n: cold.length,
      unit: "ms",
    },
    "startup.warm": {
      p50: Math.round(percentile(warm, 50)),
      p95: Math.round(percentile(warm, 95)),
      n: warm.length,
      unit: "ms",
    },
  },
};
console.log(JSON.stringify(results.benchmarks, null, 2));
if (outFile) writeFileSync(outFile, JSON.stringify(results, null, 2));
