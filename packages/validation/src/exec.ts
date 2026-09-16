import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Process helpers live in the runtime package so validators and deployment adapters share one implementation.
export { resolveProjectBin, runCommand, toProjectRelative } from "@autoappz/runtime";
export type { CommandRun } from "@autoappz/runtime";

/** `require` rooted at the project so its own dependencies (e.g. `typescript`) resolve. */
export function projectRequire(projectRoot: string): NodeJS.Require {
  return createRequire(path.join(projectRoot, "package.json"));
}

export function tryProjectRequire(projectRoot: string, id: string): unknown {
  try {
    return projectRequire(projectRoot)(id);
  } catch {
    return undefined;
  }
}

export function fileExists(p: string): boolean {
  return existsSync(p);
}
