import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectPackageManager, resolveExecutable } from "@autoappz/runtime";
import { fileExists, resolveProjectBin, runCommand } from "../exec.ts";
import { parseBuildOutput, parseEslintJson, parseTscOutput, parseVitestJson } from "../parsers.ts";
import type { Diagnostic, ValidationResult, Validator, ValidatorContext } from "../types.ts";

const LINTABLE = /\.(m|c)?[jt]sx?$/;
const ESLINT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc",
];

function result(
  validator: string,
  started: number,
  status: ValidationResult["status"],
  diagnostics: Diagnostic[],
  note?: string,
): ValidationResult {
  return {
    validator,
    status,
    diagnostics,
    durationMs: Date.now() - started,
    truncated: diagnostics.length >= 200,
    note,
  };
}

function toolFailure(
  validator: string,
  started: number,
  run: { timedOut: boolean; exitCode: number | null; stderr: string; stdout: string },
  timeoutMs: number,
): ValidationResult {
  const note = run.timedOut
    ? `${validator} timed out after ${String(Math.round(timeoutMs / 1000))} s`
    : `${validator} exited with ${String(run.exitCode)}: ${(run.stderr || run.stdout).trim().split(/\r?\n/).slice(-3).join(" | ").slice(0, 400)}`;
  return result(validator, started, "error", [], note);
}

/** Tier 1: `tsc -p tsconfig.json --noEmit` when the project has a tsconfig and a resolvable tsc. */
export const typecheckValidator: Validator = {
  id: "typecheck",
  tier: 1,
  applies(ctx) {
    if (!fileExists(path.join(ctx.projectRoot, "tsconfig.json")))
      return Promise.resolve({ ok: false, reason: "no tsconfig.json" });
    if (!resolveProjectBin(ctx.projectRoot, "tsc", ctx.env))
      return Promise.resolve({ ok: false, reason: "typescript is not installed (run install first)" });
    return Promise.resolve({ ok: true });
  },
  async run(ctx) {
    const started = Date.now();
    const tsc = resolveProjectBin(ctx.projectRoot, "tsc", ctx.env);
    if (!tsc) return result("typecheck", started, "skipped", [], "tsc not found");
    const run = await runCommand({
      file: tsc.file,
      args: [...tsc.args, "-p", "tsconfig.json", "--noEmit", "--pretty", "false"],
      cwd: ctx.projectRoot,
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      env: ctx.env,
    });
    if (run.timedOut) return toolFailure("typecheck", started, run, ctx.timeoutMs);
    if (run.exitCode === 0) return result("typecheck", started, "passed", []);
    const diagnostics = parseTscOutput(ctx.projectRoot, `${run.stdout}\n${run.stderr}`);
    if (diagnostics.length === 0) return toolFailure("typecheck", started, run, ctx.timeoutMs);
    return result("typecheck", started, "failed", diagnostics);
  },
};

/** Tier 1: ESLint over the changed files when the project has a config and a resolvable eslint. */
export const lintValidator: Validator = {
  id: "lint",
  tier: 1,
  applies(ctx) {
    if (!ESLINT_CONFIGS.some((c) => fileExists(path.join(ctx.projectRoot, c))))
      return Promise.resolve({ ok: false, reason: "no ESLint config" });
    if (!resolveProjectBin(ctx.projectRoot, "eslint", ctx.env))
      return Promise.resolve({ ok: false, reason: "eslint is not installed" });
    const files = lintableFiles(ctx);
    if (files.length === 0) return Promise.resolve({ ok: false, reason: "no changed files to lint" });
    return Promise.resolve({ ok: true });
  },
  async run(ctx) {
    const started = Date.now();
    const eslint = resolveProjectBin(ctx.projectRoot, "eslint", ctx.env);
    const files = lintableFiles(ctx);
    if (!eslint || files.length === 0) return result("lint", started, "skipped", [], "nothing to lint");
    const run = await runCommand({
      file: eslint.file,
      args: [...eslint.args, "--format", "json", "--no-error-on-unmatched-pattern", "--", ...files],
      cwd: ctx.projectRoot,
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      env: ctx.env,
    });
    if (run.timedOut) return toolFailure("lint", started, run, ctx.timeoutMs);
    const diagnostics = parseEslintJson(ctx.projectRoot, run.stdout);
    if (run.exitCode !== 0 && run.exitCode !== 1 && diagnostics.length === 0)
      return toolFailure("lint", started, run, ctx.timeoutMs);
    const errors = diagnostics.filter((d) => d.severity === "error");
    return result("lint", started, errors.length > 0 ? "failed" : "passed", diagnostics);
  },
};

function lintableFiles(ctx: ValidatorContext): string[] {
  return ctx.changedPaths.filter((p) => LINTABLE.test(p) && existsSync(path.join(ctx.projectRoot, p)));
}

/** Tier 2: tests related to the changed files (`vitest related`), or the whole suite when nothing changed. */
export const testsValidator: Validator = {
  id: "tests",
  tier: 2,
  applies(ctx) {
    if (!fileExists(path.join(ctx.projectRoot, "package.json")))
      return Promise.resolve({ ok: false, reason: "no package.json" });
    if (!resolveProjectBin(ctx.projectRoot, "vitest", ctx.env))
      return Promise.resolve({ ok: false, reason: "vitest is not installed" });
    return Promise.resolve({ ok: true });
  },
  async run(ctx) {
    const started = Date.now();
    const vitest = resolveProjectBin(ctx.projectRoot, "vitest", ctx.env);
    if (!vitest) return result("tests", started, "skipped", [], "vitest not found");
    const dir = mkdtempSync(path.join(tmpdir(), "autoappz-vitest-"));
    const outputFile = path.join(dir, "results.json");
    const related = ctx.changedPaths.filter((p) => existsSync(path.join(ctx.projectRoot, p)));
    const args = related.length > 0 ? ["related", "--run", ...related] : ["run"];
    try {
      const run = await runCommand({
        file: vitest.file,
        args: [...vitest.args, ...args, "--passWithNoTests", "--reporter=json", `--outputFile=${outputFile}`],
        cwd: ctx.projectRoot,
        timeoutMs: ctx.timeoutMs,
        signal: ctx.signal,
        env: ctx.env,
      });
      if (run.timedOut) return toolFailure("tests", started, run, ctx.timeoutMs);
      const json = existsSync(outputFile) ? readFileSync(outputFile, "utf8") : run.stdout;
      const summary = parseVitestJson(ctx.projectRoot, json);
      if (!summary)
        return run.exitCode === 0
          ? result("tests", started, "passed", [], "no test output")
          : toolFailure("tests", started, run, ctx.timeoutMs);
      const note = `${String(summary.passed)} passed, ${String(summary.failed)} failed of ${String(summary.total)}`;
      if (summary.failed === 0 && run.exitCode !== 0 && summary.diagnostics.length === 0)
        return toolFailure("tests", started, run, ctx.timeoutMs);
      return result(
        "tests",
        started,
        summary.failed > 0 || summary.diagnostics.length > 0 ? "failed" : "passed",
        summary.diagnostics,
        note,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

/** Tier 3: the project's `build` script through its package manager. */
export const buildValidator: Validator = {
  id: "build",
  tier: 3,
  applies(ctx) {
    const pkg = readPackage(ctx.projectRoot);
    if (!pkg?.scripts?.["build"]) return Promise.resolve({ ok: false, reason: "no build script" });
    const pm = detectPackageManager(ctx.projectRoot);
    if (!resolveExecutable(pm, ctx.env ?? process.env))
      return Promise.resolve({ ok: false, reason: `${pm} is not installed` });
    return Promise.resolve({ ok: true });
  },
  async run(ctx) {
    const started = Date.now();
    const pm = detectPackageManager(ctx.projectRoot);
    const exe = resolveExecutable(pm, ctx.env ?? process.env);
    if (!exe) return result("build", started, "skipped", [], `${pm} not found`);
    const run = await runCommand({
      file: exe.file,
      args: [...exe.args, "run", "build"],
      cwd: ctx.projectRoot,
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      env: ctx.env,
    });
    if (run.timedOut) return toolFailure("build", started, run, ctx.timeoutMs);
    if (run.exitCode === 0) return result("build", started, "passed", []);
    const diagnostics = parseBuildOutput(ctx.projectRoot, `${run.stdout}\n${run.stderr}`);
    if (diagnostics.length === 0) return toolFailure("build", started, run, ctx.timeoutMs);
    return result("build", started, "failed", diagnostics);
  },
};

function readPackage(root: string): { scripts?: Record<string, string> } | undefined {
  try {
    return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
  } catch {
    return undefined;
  }
}
