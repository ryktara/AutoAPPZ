# ADR-008: Project checkpoint model (git-native)

**Status:** Accepted · **Date:** 2026-09-16

## Context
Undo must never destroy uncommitted user work; the reference commits per turn and preserves dirty trees via an `[Interrupted]` commit only in some paths.

## Decision
Before any consequential task:
1. Inspect working tree (`git status --porcelain=v2 -z`).
2. If dirty, snapshot the user's uncommitted changes (index + worktree, including untracked non-ignored files) into a **checkpoint ref** `refs/autoappz/checkpoints/<taskId>/base` using a temporary index (never touching the user's index/worktree).
3. Record checkpoint metadata in the platform DB (`checkpoints {taskId, headBefore, baseSnapshot, branch, createdAt}`).
4. Agent edits are committed on the working branch at task end with a trailer `AutoAPPZ-Task: <taskId>`; intermediate states may be snapshotted to `refs/autoappz/checkpoints/<taskId>/step-N`.
5. UI shows the diff (checkpoint base → result).

Operations: **undo task** (revert commits or restore worktree from base snapshot while re-applying the user's captured changes), **restore file**, **compare checkpoints**, **create branch from checkpoint**, **continue from historical state** (detached preview with explicit return). History is never rewritten; refs are pruned by retention policy.

## Alternatives
Stash-based (fragile, conflicts with user stashes), copying the tree (slow, large), shadow repo (double bookkeeping).

## Consequences
Requires careful handling of merge/rebase-in-progress states (refuse with guidance) and of large binary files (size caps).

## Migration impact
None.
