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
