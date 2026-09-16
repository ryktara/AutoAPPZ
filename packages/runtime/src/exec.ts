import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { buildChildEnv, resolveCmdShim, resolveExecutable, type ResolvedCommand } from "./command.ts";
import { LineSplitter } from "./output.ts";
import { killTree } from "./process.ts";

export interface CommandRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

export interface RunCommandInput {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Receives each complete output line as it arrives (build logs, deploy progress). */
  readonly onLine?: ((stream: "stdout" | "stderr", line: string) => void) | undefined;
  readonly maxOutputChars?: number | undefined;
}

const DEFAULT_MAX_OUTPUT = 400_000;

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

/** Spawns argument arrays only (never a shell); output is bounded; timeout/abort kills the process tree. */
export function runCommand(input: RunCommandInput): Promise<CommandRun> {
  const max = input.maxOutputChars ?? DEFAULT_MAX_OUTPUT;
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
    const splitters = { stdout: new LineSplitter(), stderr: new LineSplitter() };
    const append = (current: string, chunk: Buffer) =>
      current.length >= max ? current : (current + chunk.toString("utf8")).slice(0, max);
    const onData = (stream: "stdout" | "stderr") => (b: Buffer) => {
      if (stream === "stdout") stdout = append(stdout, b);
      else stderr = append(stderr, b);
      if (input.onLine)
        for (const line of splitters[stream].push(b.toString("utf8"))) input.onLine(stream, line);
    };
    child.stdout.on("data", onData("stdout"));
    child.stderr.on("data", onData("stderr"));
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
      if (input.onLine) {
        for (const line of splitters.stdout.flush()) input.onLine("stdout", line);
        for (const line of splitters.stderr.flush()) input.onLine("stderr", line);
      }
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
