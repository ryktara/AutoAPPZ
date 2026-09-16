import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FrameworkInfo } from "./types.ts";

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Detects how a project builds and what it produces, from package.json and config files only. */
export function detectFramework(projectRoot: string): FrameworkInfo {
  const pkg = readPackage(projectRoot);
  const packageManager =
    existsSync(path.join(projectRoot, "pnpm-lock.yaml")) ||
    existsSync(path.join(projectRoot, "pnpm-workspace.yaml"))
      ? "pnpm"
      : existsSync(path.join(projectRoot, "yarn.lock"))
        ? "yarn"
        : "npm";
  if (!pkg) {
    const isStatic = existsSync(path.join(projectRoot, "index.html"));
    return {
      framework: isStatic ? "static" : "unknown",
      outputDir: ".",
      hasBuildScript: false,
      hasStartScript: false,
      static: isStatic,
      packageManager,
    };
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts ?? {};
  const hasBuildScript = typeof scripts["build"] === "string";
  const hasStartScript = typeof scripts["start"] === "string";
  if ("next" in deps) {
    const exported = /output\s*:\s*["']export["']/.test(
      readText(path.join(projectRoot, "next.config.ts")) +
        readText(path.join(projectRoot, "next.config.js")) +
        readText(path.join(projectRoot, "next.config.mjs")),
    );
    return {
      framework: "nextjs",
      outputDir: exported ? "out" : ".next",
      hasBuildScript,
      hasStartScript,
      static: exported,
      packageManager,
    };
  }
  const serverDeps = ["@hono/node-server", "express", "fastify", "koa"];
  if (serverDeps.some((d) => d in deps) && hasStartScript) {
    return {
      framework: "node",
      outputDir: "dist",
      hasBuildScript,
      hasStartScript,
      static: false,
      packageManager,
    };
  }
  if ("vite" in deps) {
    return {
      framework: "vite",
      outputDir: "dist",
      hasBuildScript,
      hasStartScript,
      static: true,
      packageManager,
    };
  }
  return {
    framework: "unknown",
    outputDir: "dist",
    hasBuildScript,
    hasStartScript,
    static: false,
    packageManager,
  };
}

function readPackage(root: string): PackageJson | undefined {
  try {
    return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

function readText(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
