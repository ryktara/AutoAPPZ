# @autoappz/core

Orchestration core.

- `TaskService` — runs tasks through the pure state machine in `@autoappz/agent`, journaling every transition to `task_events`.
  - `ask` tasks: read-only answer, streamed.
  - `build` tasks (M6): complexity profile → planner (skipped for trivial) → approval gate unless the project/user policy auto-approves → builder tool loop under the permission engine (read-before-write, consent parking, per-project write serialisation) → validate (validators land in M10; explicit pass) → reviewer (complex only, one bounded re-execute round) → complete. Approve / revise (re-plan with feedback) / reject; step and model-call budgets end in `NEEDS_USER`; interrupted tasks resume into validation without re-executing edits.
  - Per-session serialisation, cancellation with partial-answer persistence, provider failures → `NEEDS_USER`, startup recovery → `INTERRUPTED`, per-task cost from the usage ledger.
- `ChangeTracker` — before/after snapshots of files touched by a task (size-capped) for the Changes pane.
- `TaskEventHub` — in-memory fan-out for `task.stream` with late-subscriber replay and text-delta coalescing.
