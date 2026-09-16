# Git Service (`packages/git`)

Canonical decision: `docs/adr/ADR-008-checkpoint-model.md`.

## Operations
`status`, `diff` (working tree / commit range / checkpoint), `createCheckpoint(taskId)`, `commitTask(taskId, message)`, `undoTask(taskId)`, `restoreFile(taskId, path)`, `compareCheckpoints(a, b)`, `branchFromCheckpoint`, `continueFrom(commit)` (detached preview with explicit return), `listBranches/switch/create`, `remotes` (via VCS adapters), `hooks` (run with timeouts, stable error codes).

## Checkpoint algorithm
1. `git status --porcelain=v2 -z` → refuse if merge/rebase/cherry-pick in progress (guidance).
2. If dirty: with `GIT_INDEX_FILE=<tmp>`, `git add -A` (respecting excludes + size caps) → `git write-tree` → `git commit-tree` (parent HEAD) → update `refs/autoappz/checkpoints/<taskId>/base`; the user's index and worktree are untouched.
3. Record checkpoint row.
4. After task: `git add` only agent-touched paths + `git commit` with trailer `AutoAPPZ-Task: <taskId>`; if the tree is unchanged, no commit.
5. Undo: `git revert --no-commit <task commits>` when linear; otherwise restore tracked files from `base` and re-apply the user's captured changes via 3-way merge; conflicts are reported per file, never auto-resolved destructively.

## Safety
- Bundled git via `dugite`; env sanitized; auth injected per invocation from the secrets service (never in remote URLs).
- Agent-facing git inspection disables `core.fsmonitor`, smudge filters and hooks.
- Large files (> 20 MB) excluded from checkpoints with a warning.
- Never `push --force`, `reset --hard`, or history rewrite on behalf of the agent.

## Implementation notes (M9)
- `GitClient` wraps dugite's bundled git (`exec(args, cwd, {env, stdin, timeoutMs, check})`); every call passes an argument array, `GIT_TERMINAL_PROMPT=0` and `LC_ALL=C`. `SAFE_INSPECT_ARGS` disables fsmonitor and hooks for agent-driven commands; snapshot/restore additionally disable `core.autocrlf`/`core.safecrlf` so the round trip is byte-faithful on Windows.
- `GitService`: `init` (refuses nested repositories), `status` (porcelain v2 parser + in-progress detection via `.git/MERGE_HEAD`, `rebase-*`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`), `createCheckpoint` (always creates the base ref, even for clean trees, so diffs have a stable anchor; files > 20 MB are excluded with `:(exclude)` pathspecs and reported), `commitTask` (temporary index seeded from HEAD so the user's staged-but-uncommitted work is never swept into the task commit; ref updated with a compare-and-swap on the old HEAD), `restorePaths`, `taskDiff` (bounded), `branchFromCheckpoint`, `branches`, `switchBranch`, `commitAll` (user commits; hooks run with a 60 s timeout).
- **Undo** restores the task-touched paths from the base snapshot instead of `git revert`: the base already contains the user's pre-task edits, so a restore returns exactly to what the user had, and non-task files are never touched. Files the user changed *after* the task result are skipped unless `force`. History is untouched (the task commit stays; undo is a new working-tree state the user may commit).
- `TaskService` calls the `TaskVcs` port before the first edit (a refused checkpoint parks the task in NEEDS_USER before anything is written) and at CHECKPOINT with the task's changed paths and the summary's first line as the message. Managed projects are initialised with an initial commit on creation; imported folders are initialised lazily on the first build unless they sit inside another repository (then undo is unavailable and the task says so).
- Deferred: `continueFrom(commit)` detached preview, step snapshots (`step-N`), remotes/auth injection and ref retention pruning.
