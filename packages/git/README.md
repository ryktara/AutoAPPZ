# @autoappz/git

Git-native checkpoints for tasks (ADR-008): `refs/autoappz/checkpoints/<taskId>/base` snapshots the working tree (including uncommitted user work) through a temporary index before a task edits; task results are committed with the trailer `AutoAPPZ-Task: <taskId>`; undo restores task-touched paths from the base.

- `createGitClient()` — dugite-backed `exec(args, cwd, options)` with a sanitised environment; argument arrays only.
- `GitService` — `init`, `status`, `createCheckpoint`, `commitTask`, `restorePaths`, `taskDiff`, `branchFromCheckpoint`, `branches`, `switchBranch`, `commitAll`.
- Refuses consequential operations while a merge/rebase/cherry-pick/revert is in progress; excludes files over 20 MB from snapshots; never force-pushes, resets hard or rewrites history.

See `docs/architecture/GIT.md`.
