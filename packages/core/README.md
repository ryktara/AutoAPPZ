# @autoappz/core

Orchestration core.

- `TaskService` — runs tasks through the pure state machine in `@autoappz/agent`, journaling every transition to `task_events`. M4 implements the read-only `ask` flow: per-session serialisation (rapid submits never interleave), streaming via `TaskEventHub`, cancellation with partial-answer persistence, provider failures → `NEEDS_USER`, crash recovery (`recoverInterrupted()` marks live tasks `INTERRUPTED` at startup), and per-task cost from the usage ledger.
- `TaskEventHub` — in-memory fan-out for `task.stream`: late subscribers replay everything so far; text deltas are coalesced per subscriber (bounded message volume).
- `ServiceContainer`, `Clock`, `Result` — composition helpers.
