import { exec as dugiteExec } from "dugite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AppError } from "@autoappz/contracts";

export interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitExecOptions {
  readonly env?: Record<string, string> | undefined;
  readonly stdin?: string | undefined;
  readonly timeoutMs?: number | undefined;
  /** Throw an AppError on non-zero exit (default true). */
  readonly check?: boolean | undefined;
}

export interface GitClient {
  exec(args: readonly string[], cwd: string, options?: GitExecOptions): Promise<GitResult>;
}

/**
 * Bundled git via dugite (ADR-009). Environment is sanitised: no terminal prompts, no credential
 * helpers unless injected per call, and agent-facing inspection disables fsmonitor/hooks via config args.
 */
export function createGitClient(): GitClient {
  return {
    async exec(args, cwd, options = {}) {
      const env: Record<string, string> = {
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "0",
        LC_ALL: "C",
        ...(options.env ?? {}),
      };
      const result = await dugiteExec([...args], cwd, {
        env,
        ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
        ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
      });
      const out: GitResult = { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
      if (options.check !== false && out.exitCode !== 0) {
        throw new AppError(
          "external",
          "git.command_failed",
          `git ${args[0] ?? ""} failed: ${out.stderr.trim() || out.stdout.trim() || `exit ${String(out.exitCode)}`}`,
          {
            details: { args: [...args], exitCode: out.exitCode },
          },
        );
      }
      return out;
    },
  };
}

/** Config flags for commands the agent runs on the user's repository: no hooks, no fsmonitor, no smudge. */
export const SAFE_INSPECT_ARGS = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"] as const;

/** Creates an empty directory for a temporary index file; caller removes it. */
export function tempIndexDir(): { dir: string; indexFile: string; cleanup(): void } {
  const dir = mkdtempSync(path.join(tmpdir(), "autoappz-git-"));
  return {
    dir,
    indexFile: path.join(dir, "index"),
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
