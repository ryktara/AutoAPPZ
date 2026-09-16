import { existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { AppError, type git as contracts } from "@autoappz/contracts";
import type { Logger } from "@autoappz/diagnostics";
import { SAFE_INSPECT_ARGS, tempIndexDir, type GitClient } from "./client.ts";

type GitStatus = contracts.GitStatus;

export const CHECKPOINT_TRAILER = "AutoAPPZ-Task";
export const CHECKPOINT_REF_PREFIX = "refs/autoappz/checkpoints";
export const MAX_SNAPSHOT_FILE_BYTES = 20 * 1024 * 1024;
const TASK_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Snapshot/restore must be byte-faithful: no line-ending or filter conversion in either direction. */
const RAW_ARGS = [...SAFE_INSPECT_ARGS, "-c", "core.autocrlf=false", "-c", "core.safecrlf=false"] as const;
const AUTHOR = ["-c", "user.name=AutoAPPZ", "-c", "user.email=autoappz@localhost"] as const;

export function checkpointBaseRef(taskId: string): string {
  if (!TASK_ID.test(taskId))
    throw new AppError("validation", "git.invalid_task_id", "Invalid task id for ref.", {
      details: { taskId },
    });
  return `${CHECKPOINT_REF_PREFIX}/${taskId}/base`;
}

export function withTaskTrailer(message: string, taskId: string): string {
  const line = `${CHECKPOINT_TRAILER}: ${taskId}`;
  if (message.includes(line)) return message;
  return `${message.trimEnd()}\n\n${line}\n`;
}

export interface UndoResult {
  readonly restored: string[];
  readonly skipped: string[];
  readonly removed: string[];
}

export interface CheckpointResult {
  readonly baseRef: string;
  readonly baseSha: string;
  readonly headBefore: string | undefined;
  /** Files above the size cap that were left out of the snapshot. */
  readonly skippedLargeFiles: string[];
}

export interface GitServiceOptions {
  client: GitClient;
  logger?: Logger | undefined;
  /** Hook timeout for user commits. */
  hookTimeoutMs?: number | undefined;
}

/**
 * Git operations for projects (ADR-008 checkpoint model). Never rewrites history, never force-pushes,
 * never runs `reset --hard`; every consequential operation refuses while a merge/rebase is in progress.
 */
export class GitService {
  private readonly git: GitClient;
  private readonly log: Logger | undefined;
  private readonly hookTimeoutMs: number;

  constructor(options: GitServiceOptions) {
    this.git = options.client;
    this.log = options.logger;
    this.hookTimeoutMs = options.hookTimeoutMs ?? 60_000;
  }

  async isRepository(root: string): Promise<boolean> {
    const r = await this.git.exec(["rev-parse", "--show-toplevel"], root, { check: false });
    if (r.exitCode !== 0) return false;
    return samePath(r.stdout.trim(), root);
  }

  /** True when `root` is inside some other repository (importing such a folder must not `git init`). */
  async isInsideRepository(root: string): Promise<boolean> {
    const r = await this.git.exec(["rev-parse", "--show-toplevel"], root, { check: false });
    return r.exitCode === 0 && !samePath(r.stdout.trim(), root);
  }

  async init(root: string, initialMessage = "Initial commit"): Promise<GitStatus> {
    if (await this.isRepository(root)) return this.status(root);
    if (await this.isInsideRepository(root)) {
      throw new AppError(
        "precondition",
        "git.nested_repository",
        "This folder is inside another git repository; not initialising a nested one.",
      );
    }
    await this.git.exec(["init", "-b", "main"], root);
    await this.git.exec([...AUTHOR, "add", "-A"], root);
    const staged = await this.git.exec(["diff", "--cached", "--quiet"], root, { check: false });
    if (staged.exitCode !== 0) await this.git.exec([...AUTHOR, "commit", "-q", "-m", initialMessage], root);
    return this.status(root);
  }

  async headSha(root: string): Promise<string | undefined> {
    const r = await this.git.exec(["rev-parse", "--verify", "-q", "HEAD"], root, { check: false });
    return r.exitCode === 0 ? r.stdout.trim() : undefined;
  }

  async status(root: string): Promise<GitStatus> {
    if (!(await this.isRepository(root)))
      return { isRepository: false, modified: [], untracked: [], conflicted: [] };
    const r = await this.git.exec(
      [...SAFE_INSPECT_ARGS, "status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
      root,
    );
    const parsed = parsePorcelainV2(r.stdout);
    const status: GitStatus = {
      isRepository: true,
      modified: parsed.modified,
      untracked: parsed.untracked,
      conflicted: parsed.conflicted,
    };
    if (parsed.branch !== undefined) status.branch = parsed.branch;
    const head = await this.headSha(root);
    if (head !== undefined) status.head = head;
    const inProgress = inProgressOperation(root);
    if (inProgress !== undefined) status.inProgress = inProgress;
    return status;
  }

  /**
   * Snapshots the working tree (index + worktree + untracked non-ignored files, minus files over the size
   * cap) into `refs/autoappz/checkpoints/<taskId>/base` using a temporary index. The user's index and
   * worktree are untouched. Refuses while a merge/rebase is in progress.
   */
  async createCheckpoint(root: string, taskId: string): Promise<CheckpointResult> {
    const ref = checkpointBaseRef(taskId);
    const status = await this.status(root);
    if (!status.isRepository)
      throw new AppError("precondition", "git.not_repository", "The project is not a git repository.");
    if (status.inProgress) {
      throw new AppError(
        "precondition",
        "git.operation_in_progress",
        `A ${status.inProgress} is in progress; finish or abort it before running a task.`,
      );
    }
    const headBefore = await this.headSha(root);
    const skippedLargeFiles = [...status.modified, ...status.untracked].filter((p) =>
      isLargeFile(path.join(root, p)),
    );
    const tmp = tempIndexDir();
    try {
      const env = { GIT_INDEX_FILE: tmp.indexFile };
      if (headBefore) await this.git.exec(["read-tree", headBefore], root, { env });
      const pathspecs = ["--", ".", ...skippedLargeFiles.map((p) => `:(exclude)${p}`)];
      await this.git.exec([...RAW_ARGS, "add", "-A", ...pathspecs], root, { env });
      const tree = (await this.git.exec(["write-tree"], root, { env })).stdout.trim();
      const parents = headBefore ? ["-p", headBefore] : [];
      const sha = (
        await this.git.exec(
          [...AUTHOR, "commit-tree", tree, ...parents, "-m", `AutoAPPZ checkpoint base for task ${taskId}`],
          root,
        )
      ).stdout.trim();
      await this.git.exec(["update-ref", ref, sha], root);
      this.log?.info("checkpoint created", {
        taskId,
        ref,
        sha,
        headBefore,
        skippedLargeFiles: skippedLargeFiles.length,
      });
      return { baseRef: ref, baseSha: sha, headBefore, skippedLargeFiles };
    } finally {
      tmp.cleanup();
    }
  }

  /** Commits only the given paths with the task trailer. Returns undefined when the tree is unchanged. */
  async commitTask(
    root: string,
    taskId: string,
    message: string,
    paths: readonly string[],
  ): Promise<string | undefined> {
    if (paths.length === 0) return undefined;
    const status = await this.status(root);
    if (status.inProgress)
      throw new AppError(
        "precondition",
        "git.operation_in_progress",
        `A ${status.inProgress} is in progress.`,
      );
    const tmp = tempIndexDir();
    try {
      // Stage in a temporary index so the user's own staged changes are never swept into the task commit.
      const env = { GIT_INDEX_FILE: tmp.indexFile };
      const head = await this.headSha(root);
      if (head) await this.git.exec(["read-tree", head], root, { env });
      await this.git.exec([...SAFE_INSPECT_ARGS, "add", "-A", "--", ...paths], root, { env });
      const diff = await this.git.exec(["diff", "--cached", "--quiet", ...(head ? [head] : [])], root, {
        env,
        check: false,
      });
      if (diff.exitCode === 0) return undefined;
      const tree = (await this.git.exec(["write-tree"], root, { env })).stdout.trim();
      const sha = (
        await this.git.exec(
          [
            ...AUTHOR,
            "commit-tree",
            tree,
            ...(head ? ["-p", head] : []),
            "-m",
            withTaskTrailer(message, taskId),
          ],
          root,
        )
      ).stdout.trim();
      const branch = await this.currentBranch(root);
      await this.git.exec(
        ["update-ref", branch ? `refs/heads/${branch}` : "HEAD", sha, ...(head ? [head] : [])],
        root,
      );
      // Bring the real index in line for the committed paths so `git status` is clean for them.
      await this.git.exec([...SAFE_INSPECT_ARGS, "add", "-A", "--", ...paths], root);
      this.log?.info("task committed", { taskId, sha, files: paths.length });
      return sha;
    } finally {
      tmp.cleanup();
    }
  }

  /**
   * Restores task-touched paths from the checkpoint base. The base already contains the user's pre-task
   * edits, so undoing the task returns exactly to what the user had. Files the user changed *after* the
   * task result are skipped unless `force`.
   */
  async restorePaths(
    root: string,
    taskId: string,
    paths: readonly string[],
    options: { force?: boolean | undefined; resultCommit?: string | undefined } = {},
  ): Promise<UndoResult> {
    const ref = checkpointBaseRef(taskId);
    const exists = await this.git.exec(["rev-parse", "--verify", "-q", ref], root, { check: false });
    if (exists.exitCode !== 0)
      throw new AppError("not_found", "git.checkpoint_missing", "No checkpoint exists for this task.", {
        details: { taskId },
      });
    const restored: string[] = [];
    const skipped: string[] = [];
    const removed: string[] = [];
    for (const p of paths) {
      if (
        !options.force &&
        options.resultCommit &&
        (await this.changedSince(root, options.resultCommit, p))
      ) {
        skipped.push(p);
        continue;
      }
      const inBase = await this.git.exec(["cat-file", "-e", `${ref}:${p}`], root, { check: false });
      if (inBase.exitCode === 0) {
        await this.git.exec([...RAW_ARGS, "checkout", ref, "--", p], root);
        restored.push(p);
      } else if (existsSync(path.join(root, p))) {
        await this.git.exec([...SAFE_INSPECT_ARGS, "rm", "-q", "-f", "--ignore-unmatch", "--", p], root);
        if (existsSync(path.join(root, p))) rmSync(path.join(root, p), { force: true });
        removed.push(p);
      }
    }
    this.log?.info("task undone", {
      taskId,
      restored: restored.length,
      skipped: skipped.length,
      removed: removed.length,
    });
    return { restored, skipped, removed };
  }

  /** Unified diff for a task: base → result commit, or base → working tree while the task is unfinished. */
  async taskDiff(
    root: string,
    taskId: string,
    resultCommit: string | undefined,
    maxChars = 200_000,
  ): Promise<{ diff: string; truncated: boolean; files: string[] }> {
    const ref = checkpointBaseRef(taskId);
    const args = resultCommit ? ["diff", ref, resultCommit, "--"] : ["diff", ref, "--"];
    const r = await this.git.exec([...SAFE_INSPECT_ARGS, ...args], root);
    const names = await this.git.exec(
      [...SAFE_INSPECT_ARGS, "diff", "--name-only", ref, ...(resultCommit ? [resultCommit] : []), "--"],
      root,
    );
    const diff = r.stdout;
    return {
      diff: diff.length > maxChars ? diff.slice(0, maxChars) : diff,
      truncated: diff.length > maxChars,
      files: names.stdout.split("\n").filter(Boolean),
    };
  }

  async branchFromCheckpoint(root: string, taskId: string, name: string): Promise<void> {
    assertBranchName(name);
    await this.git.exec(["branch", name, checkpointBaseRef(taskId)], root);
  }

  async branches(root: string): Promise<{ current: string | undefined; branches: string[] }> {
    const r = await this.git.exec(["branch", "--format=%(refname:short)"], root);
    return {
      current: await this.currentBranch(root),
      branches: r.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  async switchBranch(root: string, name: string): Promise<void> {
    assertBranchName(name);
    const status = await this.status(root);
    if (status.inProgress)
      throw new AppError(
        "precondition",
        "git.operation_in_progress",
        `A ${status.inProgress} is in progress.`,
      );
    const r = await this.git.exec([...SAFE_INSPECT_ARGS, "switch", name], root, { check: false });
    if (r.exitCode !== 0)
      throw new AppError(
        "conflict",
        "git.switch_failed",
        r.stderr.trim() || "Could not switch branch; commit or stash your changes first.",
      );
  }

  /** User commit of everything (hooks run, bounded). */
  async commitAll(root: string, message: string): Promise<string | undefined> {
    await this.git.exec(["add", "-A"], root);
    const staged = await this.git.exec(["diff", "--cached", "--quiet"], root, { check: false });
    if (staged.exitCode === 0) return undefined;
    const r = await this.git.exec([...AUTHOR, "commit", "-q", "-m", message], root, {
      check: false,
      timeoutMs: this.hookTimeoutMs,
    });
    if (r.exitCode !== 0)
      throw new AppError(
        "external",
        "git.commit_failed",
        r.stderr.trim() || r.stdout.trim() || "Commit failed (a hook may have rejected it).",
      );
    return this.headSha(root);
  }

  async currentBranch(root: string): Promise<string | undefined> {
    const r = await this.git.exec(["symbolic-ref", "--short", "-q", "HEAD"], root, { check: false });
    return r.exitCode === 0 ? r.stdout.trim() : undefined;
  }

  private async changedSince(root: string, commit: string, p: string): Promise<boolean> {
    const r = await this.git.exec([...SAFE_INSPECT_ARGS, "diff", "--quiet", commit, "--", p], root, {
      check: false,
    });
    return r.exitCode !== 0;
  }
}

function assertBranchName(name: string): void {
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.startsWith("-") || name.includes("..") || name.endsWith("/")) {
    throw new AppError("validation", "git.invalid_branch", "Invalid branch name.", { details: { name } });
  }
}

function isLargeFile(absolute: string): boolean {
  try {
    return statSync(absolute).size > MAX_SNAPSHOT_FILE_BYTES;
  } catch {
    return false;
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) =>
    path
      .resolve(p)
      .replace(/[\\/]+$/, "")
      .toLowerCase();
  return norm(a) === norm(b);
}

export function inProgressOperation(root: string): GitStatus["inProgress"] {
  const g = path.join(root, ".git");
  if (existsSync(path.join(g, "MERGE_HEAD"))) return "merge";
  if (existsSync(path.join(g, "rebase-merge")) || existsSync(path.join(g, "rebase-apply"))) return "rebase";
  if (existsSync(path.join(g, "CHERRY_PICK_HEAD"))) return "cherry-pick";
  if (existsSync(path.join(g, "REVERT_HEAD"))) return "revert";
  return undefined;
}

/** Parses `git status --porcelain=v2 -z --branch`. */
export function parsePorcelainV2(out: string): {
  branch: string | undefined;
  modified: string[];
  untracked: string[];
  conflicted: string[];
} {
  const modified: string[] = [];
  const untracked: string[] = [];
  const conflicted: string[] = [];
  let branch: string | undefined;
  const entries = out.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] ?? "";
    if (e.startsWith("# branch.head ")) {
      const b = e.slice("# branch.head ".length);
      branch = b === "(detached)" ? undefined : b;
    } else if (e.startsWith("1 ")) {
      modified.push(e.split(" ").slice(8).join(" "));
    } else if (e.startsWith("2 ")) {
      // rename: "2 XY sub mH mI mW hH hI Xscore path\0origPath"
      modified.push(e.split(" ").slice(9).join(" "));
      i += 1;
    } else if (e.startsWith("u ")) {
      conflicted.push(e.split(" ").slice(10).join(" "));
    } else if (e.startsWith("? ")) {
      untracked.push(e.slice(2));
    }
  }
  return { branch, modified, untracked, conflicted };
}
