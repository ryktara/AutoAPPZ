import { cpSync, existsSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withTempDir } from "@autoappz/testing";
import {
  bracketProblem,
  parseEslintJson,
  parseTscOutput,
  parseVitestJson,
  renderRepairNotes,
  resolveProjectBin,
  runValidation,
  selectDiagnostics,
  summarizeReport,
  syntaxValidator,
  type ValidationReport,
} from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "ts-app");
const REPO_NODE_MODULES = path.resolve(here, "../../../node_modules");

/** Copies the fixture and links the monorepo's node_modules so tsc/eslint/vitest/typescript resolve. */
async function withProject<T>(fn: (root: string) => Promise<T>): Promise<T> {
  return withTempDir(async (dir) => {
    const root = path.join(dir, "ts-app");
    cpSync(FIXTURE, root, { recursive: true });
    symlinkSync(REPO_NODE_MODULES, path.join(root, "node_modules"), "junction");
    return fn(root);
  });
}

const signal = () => new AbortController().signal;

describe("parsers", () => {
  it("parses tsc output in both formats", () => {
    const out = parseTscOutput(
      "/p",
      [
        "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.",
        "src/b.tsx:10:2 - error TS2304: Cannot find name 'Foo'.",
        "Found 2 errors.",
      ].join("\n"),
    );
    expect(out).toEqual([
      {
        validator: "typecheck",
        severity: "error",
        code: "TS2322",
        message: "Type 'string' is not assignable to type 'number'.",
        file: "src/a.ts",
        line: 3,
        column: 5,
      },
      {
        validator: "typecheck",
        severity: "error",
        code: "TS2304",
        message: "Cannot find name 'Foo'.",
        file: "src/b.tsx",
        line: 10,
        column: 2,
      },
    ]);
  });

  it("parses eslint json and vitest json", () => {
    const eslint = parseEslintJson(
      "/p",
      `Debug noise\n${JSON.stringify([
        {
          filePath: "/p/src/a.ts",
          messages: [
            { ruleId: "no-var", severity: 2, message: "Unexpected var", line: 1, column: 1 },
            { ruleId: "prefer-const", severity: 1, message: "Use const", line: 2, column: 3 },
          ],
        },
      ])}`,
    );
    expect(eslint.map((d) => [d.file, d.severity, d.code])).toEqual([
      ["src/a.ts", "error", "no-var"],
      ["src/a.ts", "warning", "prefer-const"],
    ]);
    const vitest = parseVitestJson(
      "/p",
      JSON.stringify({
        numTotalTests: 2,
        numFailedTests: 1,
        numPassedTests: 1,
        testResults: [
          {
            name: "/p/src/math.test.ts",
            status: "failed",
            assertionResults: [
              { fullName: "adds", status: "passed" },
              {
                fullName: "multiplies",
                status: "failed",
                failureMessages: ["AssertionError: expected 7 to be 6\n    at /p/src/math.test.ts:9:24"],
              },
            ],
          },
        ],
      }),
    );
    expect(vitest).toMatchObject({ total: 2, failed: 1, passed: 1 });
    expect(vitest?.diagnostics[0]).toMatchObject({
      validator: "tests",
      code: "TEST_FAILED",
      file: "src/math.test.ts",
      line: 9,
      message: "multiplies: AssertionError: expected 7 to be 6",
    });
  });

  it("bracket heuristic finds unbalanced code and ignores strings/comments", () => {
    expect(bracketProblem('const a = "}"; // }\nfunction f() {\n  return [1, 2];\n}\n')).toBeUndefined();
    expect(bracketProblem("function f() {\n  return 1;\n")).toEqual({ line: 1, message: "Unclosed '{'" });
    expect(bracketProblem("const x = (1 + 2];")).toEqual({ line: 1, message: "Unexpected ']'" });
  });
});

describe("validators on the fixture project", () => {
  it("resolves project-local CLIs walking up from the project", () => {
    const tsc = resolveProjectBin(FIXTURE, "tsc");
    expect(tsc).toBeDefined();
    expect(existsSync(tsc?.file ?? "")).toBe(true);
    expect(resolveProjectBin(FIXTURE, "definitely-not-a-cli-xyz")).toBeUndefined();
  });

  it("syntax validator uses the project's typescript for changed files", async () => {
    await withProject(async (root) => {
      writeFileSync(path.join(root, "src", "broken.ts"), "export const x = ;\n");
      writeFileSync(path.join(root, "src", "bad.json"), "{ not json");
      const r = await syntaxValidator.run({
        projectRoot: root,
        changedPaths: ["src/broken.ts", "src/bad.json", "src/math.ts", "missing.ts"],
        signal: signal(),
        timeoutMs: 5_000,
      });
      expect(r.status).toBe("failed");
      expect(r.diagnostics.map((d) => [d.file, d.code])).toEqual([
        ["src/broken.ts", "SYNTAX"],
        ["src/bad.json", "JSON_PARSE"],
      ]);
      expect(r.diagnostics[0]?.line).toBe(1);
      expect(r.note).toBeUndefined(); // typescript resolved from the linked node_modules
    });
  });

  it("runs tiers in order, stops at the first failing tier and reports skips with reasons", async () => {
    await withProject(async (root) => {
      writeFileSync(
        path.join(root, "src", "index.ts"),
        'import { add } from "./math.ts";\n\nexport const total: string = add(1, 2);\n',
      );
      const report = await runValidation({
        projectRoot: root,
        changedPaths: ["src/index.ts"],
        signal: signal(),
        maxTier: 2,
        attempt: 1,
      });
      const byId = Object.fromEntries(report.results.map((r) => [r.validator, r]));
      expect(byId["syntax"]?.status).toBe("passed");
      expect(byId["typecheck"]?.status).toBe("failed");
      expect(byId["typecheck"]?.diagnostics[0]).toMatchObject({
        file: "src/index.ts",
        line: 3,
        code: "TS2322",
      });
      expect(byId["tests"]).toMatchObject({ status: "skipped", note: "skipped: tier 1 failed" });
      expect(byId["build"]).toMatchObject({ status: "skipped", note: "not run for this task profile" });
      expect(report.ok).toBe(false);
      const selected = selectDiagnostics(report, ["src/index.ts"]);
      expect(selected).toHaveLength(1);
      expect(renderRepairNotes(selected, report)[0]).toMatch(/^typecheck: src\/index\.ts:3:\d+ TS2322 — /);
      expect(summarizeReport(report)).toContain("typecheck failed (1)");
    });
  }, 90_000);

  it("lint and related tests run on changed files and pass on a clean project", async () => {
    await withProject(async (root) => {
      writeFileSync(
        path.join(root, "src", "math.ts"),
        "export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function multiply(a: number, b: number): number {\n  return a * b;\n}\n",
      );
      const report = await runValidation({
        projectRoot: root,
        changedPaths: ["src/math.ts"],
        signal: signal(),
        maxTier: 2,
        attempt: 1,
      });
      const byId = Object.fromEntries(report.results.map((r) => [r.validator, r]));
      expect(byId["typecheck"]?.status).toBe("passed");
      expect(byId["lint"]?.status).toBe("passed");
      expect(byId["tests"]).toMatchObject({ status: "passed" });
      expect(byId["tests"]?.note).toMatch(/2 passed, 0 failed of 2/);
      expect(report.ok).toBe(true);
    });
  }, 120_000);

  it("lint errors and failing tests are reported with file and line", async () => {
    await withProject(async (root) => {
      writeFileSync(
        path.join(root, "src", "math.ts"),
        "export function add(a: number, b: number): number {\n  var total = a + b;\n  return total + 1;\n}\n\nexport function multiply(a: number, b: number): number {\n  return a * b;\n}\n",
      );
      const report = await runValidation({
        projectRoot: root,
        changedPaths: ["src/math.ts"],
        signal: signal(),
        maxTier: 2,
        attempt: 2,
      });
      const byId = Object.fromEntries(report.results.map((r) => [r.validator, r]));
      expect(byId["lint"]?.status).toBe("failed");
      expect(
        byId["lint"]?.diagnostics.some(
          (d) => d.code === "no-var" && d.file === "src/math.ts" && d.line === 2,
        ),
      ).toBe(true);
      // tier 2 is skipped because tier 1 failed; run tests alone to see the failure surface
      const tests = await runValidation({
        projectRoot: root,
        changedPaths: ["src/math.ts"],
        signal: signal(),
        maxTier: 2,
        attempt: 3,
        validators: [(await import("../src/index.ts")).testsValidator],
      });
      expect(tests.results[0]?.status).toBe("failed");
      expect(tests.results[0]?.diagnostics[0]).toMatchObject({
        code: "TEST_FAILED",
        file: "src/math.test.ts",
      });
      expect(tests.results[0]?.diagnostics[0]?.message).toContain("adds");
    });
  }, 120_000);

  it("cancellation and timeouts end a validator with status error, never hanging", async () => {
    await withProject(async (root) => {
      const report = await runValidation({
        projectRoot: root,
        changedPaths: ["src/index.ts"],
        signal: signal(),
        maxTier: 1,
        attempt: 1,
        timeoutsMs: { 1: 1 },
      });
      const typecheck = report.results.find((r) => r.validator === "typecheck");
      expect(typecheck?.status).toBe("error");
      expect(typecheck?.note).toMatch(/timed out/);
      expect(report.ok).toBe(true); // tool errors are reported, not treated as failing checks
    });
  }, 60_000);
});

describe("repair selection", () => {
  it("prefers errors in changed files, dedupes and caps", () => {
    const d = (file: string, line: number, severity: "error" | "warning", code = "X") => ({
      validator: "typecheck",
      severity,
      code,
      message: "m",
      file,
      line,
      column: 1,
    });
    const report: ValidationReport = {
      attempt: 1,
      ok: false,
      results: [],
      diagnostics: [
        d("b.ts", 1, "warning"),
        d("a.ts", 5, "error"),
        d("a.ts", 5, "error"),
        d("c.ts", 2, "error"),
        d("a.ts", 9, "error"),
      ],
      durationMs: 1,
      startedAt: 0,
    };
    const selected = selectDiagnostics(report, ["a.ts"], 3);
    expect(selected.map((x) => `${x.file ?? ""}:${String(x.line ?? 0)}`)).toEqual([
      "a.ts:5",
      "a.ts:9",
      "c.ts:2",
    ]);
    expect(renderRepairNotes(selected, report).at(-1)).toContain("1 more diagnostic(s) not shown");
  });
});
