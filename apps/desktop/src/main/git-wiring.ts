import type { CommandBusHost } from "@autoappz/command-bus";
import { AppError, git as contracts, workspace } from "@autoappz/contracts";
import type { TaskService, TaskVcs } from "@autoappz/core";
import type { Logger } from "@autoappz/diagnostics";
import { GitService, createGitClient } from "@autoappz/git";
import type { ProjectCatalog } from "@autoappz/project";
import type { CheckpointsRepository } from "@autoappz/storage";

export interface GitWiring {
  git: GitService;
  vcs: TaskVcs;
}

/**
 * Bridges the task runner's version-control port to git: checkpoints before edits, trailer commits after.
 * Projects that are not repositories are initialised on first use unless they sit inside another repo.
 */
export function createGitWiring(input: {
  bus: CommandBusHost;
  checkpoints: CheckpointsRepository;
  logger: Logger;
  now?: (() => number) | undefined;
  newId?: ((prefix: string) => string) | undefined;
}): GitWiring {
  const git = new GitService({ client: createGitClient(), logger: input.logger });
  const now = input.now ?? Date.now;
  const newId =
    input.newId ?? ((prefix) => `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const vcs: TaskVcs = {
    async checkpoint(task) {
      if (!(await git.isRepository(task.projectPath))) {
        if (await git.isInsideRepository(task.projectPath)) {
          return { ok: false, reason: "the project folder is inside another git repository" };
        }
        await git.init(task.projectPath, "Initial commit (AutoAPPZ)");
      }
      const result = await git.createCheckpoint(task.projectPath, task.id);
      const checkpoint: contracts.Checkpoint = {
        id: newId("cp"),
        taskId: task.id,
        projectId: task.projectId,
        baseSnapshotRef: result.baseRef,
        baseSha: result.baseSha,
        createdAt: now(),
      };
      if (result.headBefore !== undefined) checkpoint.headBefore = result.headBefore;
      input.checkpoints.insert(checkpoint);
      return { ok: true, skippedLargeFiles: result.skippedLargeFiles };
    },
    async commit(task, message, paths) {
      if (!input.checkpoints.byTask(task.id)) return { sha: undefined };
      const sha = await git.commitTask(task.projectPath, task.id, message, paths);
      input.checkpoints.setResult(task.id, sha);
      input.bus.publish(contracts.gitChanged, { projectId: task.projectId });
      input.bus.publish(workspace.cacheInvalidate, { scopes: ["git"] });
      return { sha };
    },
  };
  return { git, vcs };
}

export function registerGitHandlers(
  bus: CommandBusHost,
  input: {
    git: GitService;
    checkpoints: CheckpointsRepository;
    projects: ProjectCatalog;
    tasks: TaskService;
  },
): void {
  const { git, checkpoints, projects, tasks } = input;
  const rootOf = (projectId: string) => projects.get(projectId).path;
  const checkpointOf = (taskId: string) => {
    const cp = checkpoints.byTask(taskId);
    if (!cp)
      throw new AppError("not_found", "git.checkpoint_missing", "No checkpoint exists for this task.", {
        details: { taskId },
      });
    return cp;
  };
  const changed = (projectId: string) => {
    bus.publish(contracts.gitChanged, { projectId });
  };

  bus.handle(contracts.gitStatus, ({ projectId }) => git.status(rootOf(projectId)));
  bus.handle(contracts.gitInit, async ({ projectId }) => {
    const status = await git.init(rootOf(projectId), "Initial commit (AutoAPPZ)");
    changed(projectId);
    return status;
  });
  bus.handle(contracts.gitCheckpoints, ({ projectId, limit }) =>
    checkpoints.listForProject(projectId, limit),
  );
  bus.handle(contracts.gitTaskDiff, ({ taskId }) => {
    const cp = checkpointOf(taskId);
    return git.taskDiff(rootOf(cp.projectId), taskId, cp.resultCommit);
  });
  bus.handle(contracts.gitUndoTask, async ({ taskId, force }) => {
    const cp = checkpointOf(taskId);
    const paths = [...new Set(tasks.changes(taskId).map((c) => c.path))];
    const result = await git.restorePaths(rootOf(cp.projectId), taskId, paths, {
      force,
      resultCommit: cp.resultCommit,
    });
    changed(cp.projectId);
    return result;
  });
  bus.handle(contracts.gitRestoreFile, async ({ taskId, path }) => {
    const cp = checkpointOf(taskId);
    if (!tasks.changes(taskId).some((c) => c.path === path)) {
      throw new AppError("validation", "git.path_not_in_task", "That file was not changed by this task.", {
        details: { path },
      });
    }
    const result = await git.restorePaths(rootOf(cp.projectId), taskId, [path], { force: true });
    changed(cp.projectId);
    return result;
  });
  bus.handle(contracts.gitBranchFromCheckpoint, async ({ taskId, name }) => {
    const cp = checkpointOf(taskId);
    await git.branchFromCheckpoint(rootOf(cp.projectId), taskId, name);
    changed(cp.projectId);
    return { name };
  });
  bus.handle(contracts.gitBranches, ({ projectId }) => git.branches(rootOf(projectId)));
  bus.handle(contracts.gitSwitch, async ({ projectId, name }) => {
    await git.switchBranch(rootOf(projectId), name);
    changed(projectId);
    return git.status(rootOf(projectId));
  });
  bus.handle(contracts.gitCommit, async ({ projectId, message }) => {
    const sha = await git.commitAll(rootOf(projectId), message);
    changed(projectId);
    return sha ? { sha, nothingToCommit: false } : { nothingToCommit: true };
  });
}
