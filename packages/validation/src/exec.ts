import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  buildChildEnv,
  killTree,
  resolveCmdShim,
  resolveExecutable,
  type ResolvedCommand,
} from "@autoappz/runtime";

export interface CommandRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

const MAX_OUTPUT_CHARS = 400_000;

/**
 * Finds a project-local CLI (`node_modules/.bin/<name>`) walking up from the project root, then PATH.
 * Windows `.cmd` shims are resolved to `node <entry>` so nothing runs through cmd.exe.
 */
export function resolveProjectBin(
  projectRoot: string,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): ResolvedCommand | undefined {
  let dir = path.resolve(projectRoot);
  for (;;) {
    const bin = path.join(dir, "node_modules", ".bin");
    if (platform === "win32") {
      const shim = path.join(bin, `${name}.cmd`);
      if (isFile(shim)) {
        const resolved = resolveCmdShim(shim, env);
        if (resolved) return resolved;
      }
    } else {
      const file = path.join(bin, name);
      if (isFile(file)) return { file, args: [] };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolveExecutable(name, env, platform);
}

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

/** Spawns argument arrays only (never a shell); output is bounded; timeout/abort kills the process tree. */
export function runCommand(input: {
  file: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv | undefined;
}): Promise<CommandRun> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(input.file, [...input.args], {
      cwd: input.cwd,
      env: buildChildEnv(
        { ...process.env, ...(input.env ?? {}) },
        { CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
      ),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const append = (current: string, chunk: Buffer) =>
      current.length >= MAX_OUTPUT_CHARS
        ? current
        : (current + chunk.toString("utf8")).slice(0, MAX_OUTPUT_CHARS);
    child.stdout.on("data", (b: Buffer) => {
      stdout = append(stdout, b);
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr = append(stderr, b);
    });
    const stop = () => {
      void killTree(child);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, input.timeoutMs);
    const onAbort = () => {
      stop();
    };
    input.signal.addEventListener("abort", onAbort, { once: true });
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal.removeEventListener("abort", onAbort);
      resolve({ exitCode, stdout, stderr, timedOut, durationMs: Date.now() - started });
    };
    child.on("error", (error) => {
      stderr += `\n${error.message}`;
      finish(null);
    });
    child.on("close", (code) => {
      finish(code);
    });
  });
}

/** Relative, forward-slash form of a path printed by a tool (absolute or cwd-relative). */
export function toProjectRelative(projectRoot: string, file: string): string {
  const abs = path.isAbsolute(file) ? file : path.join(projectRoot, file);
  const rel = path.relative(projectRoot, abs);
  return (rel.startsWith("..") ? file : rel).replace(/\\/g, "/");
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function fileExists(p: string): boolean {
  return existsSync(p);
}
