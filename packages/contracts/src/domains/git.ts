import { z } from "zod";
import { defineCommand, defineEvent, defineQuery } from "../definitions.ts";
import { ProjectIdSchema, TaskIdSchema } from "../common.ts";

export const GitStatusSchema = z.object({
  isRepository: z.boolean(),
  branch: z.string().optional(),
  head: z.string().optional(),
  /** Tracked files with uncommitted changes (project-relative). */
  modified: z.array(z.string()),
  /** Untracked, non-ignored files. */
  untracked: z.array(z.string()),
  conflicted: z.array(z.string()),
  /** merge / rebase / cherry-pick in progress: consequential operations refuse until resolved. */
  inProgress: z.enum(["merge", "rebase", "cherry-pick", "revert"]).optional(),
});
export type GitStatus = z.infer<typeof GitStatusSchema>;

export const CheckpointSchema = z.object({
  id: z.string().min(1),
  taskId: TaskIdSchema,
  projectId: ProjectIdSchema,
  /** HEAD when the task started (undefined for an empty repository). */
  headBefore: z.string().optional(),
  /** `refs/autoappz/checkpoints/<taskId>/base` — snapshot of the tree including the user's uncommitted work. */
  baseSnapshotRef: z.string().min(1),
  baseSha: z.string().optional(),
  /** Commit created at task end (trailer `AutoAPPZ-Task: <taskId>`); absent when nothing changed or the task did not finish. */
  resultCommit: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const gitStatus = defineQuery({
  name: "git.status",
  input: z.object({ projectId: ProjectIdSchema }),
  output: GitStatusSchema,
  scope: "git",
});

export const gitInit = defineCommand({
  name: "git.init",
  input: z.object({ projectId: ProjectIdSchema }),
  output: GitStatusSchema,
  invalidates: ["git"],
});

export const gitCheckpoints = defineQuery({
  name: "git.checkpoints",
  input: z.object({ projectId: ProjectIdSchema, limit: z.number().int().min(1).max(200).default(50) }),
  output: z.array(
    CheckpointSchema.extend({ request: z.string().optional(), taskState: z.string().optional() }),
  ),
  scope: "git",
});

/** Unified diff between the checkpoint base and the task result (or the working tree while unfinished). Bounded. */
export const gitTaskDiff = defineQuery({
  name: "git.taskDiff",
  input: z.object({ taskId: TaskIdSchema }),
  output: z.object({ diff: z.string(), truncated: z.boolean(), files: z.array(z.string()) }),
  scope: "git",
});

export const UndoResultSchema = z.object({
  restored: z.array(z.string()),
  /** Files changed by the user after the task; left alone unless `force`. */
  skipped: z.array(z.string()),
  removed: z.array(z.string()),
});
export type UndoResult = z.infer<typeof UndoResultSchema>;

/** Restores every task-touched file to the checkpoint base. User edits captured in the base are kept. */
export const gitUndoTask = defineCommand({
  name: "git.undoTask",
  input: z.object({ taskId: TaskIdSchema, force: z.boolean().default(false) }),
  output: UndoResultSchema,
  invalidates: ["git", "changes"],
});

export const gitRestoreFile = defineCommand({
  name: "git.restoreFile",
  input: z.object({ taskId: TaskIdSchema, path: z.string().min(1) }),
  output: UndoResultSchema,
  invalidates: ["git", "changes"],
});

export const gitBranchFromCheckpoint = defineCommand({
  name: "git.branchFromCheckpoint",
  input: z.object({ taskId: TaskIdSchema, name: z.string().min(1).max(120) }),
  output: z.object({ name: z.string() }),
  invalidates: ["git"],
});

export const gitBranches = defineQuery({
  name: "git.branches",
  input: z.object({ projectId: ProjectIdSchema }),
  output: z.object({ current: z.string().optional(), branches: z.array(z.string()) }),
  scope: "git",
});

export const gitSwitch = defineCommand({
  name: "git.switch",
  input: z.object({ projectId: ProjectIdSchema, name: z.string().min(1).max(120) }),
  output: GitStatusSchema,
  invalidates: ["git"],
});

/** User-initiated commit of all uncommitted changes; hooks run with a timeout. */
export const gitCommit = defineCommand({
  name: "git.commit",
  input: z.object({ projectId: ProjectIdSchema, message: z.string().trim().min(1).max(4000) }),
  output: z.object({ sha: z.string().optional(), nothingToCommit: z.boolean() }),
  invalidates: ["git"],
});

export const gitChanged = defineEvent({
  name: "git.changed",
  payload: z.object({ projectId: ProjectIdSchema }),
});
