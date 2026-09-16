# @autoappz/agent

Agent logic that is pure and testable without I/O.

- `transition(state, event, ctx)` — the task state machine (`docs/design/AGENT-ARCHITECTURE.md`). Unknown pairs are no-ops; cancel/failure/process-exit apply from any live state; repair attempts are bounded.
- `classifyComplexity(request)` — first-pass trivial/standard/complex estimate used for routing and approval policy.
- `prompts/` — versioned prompt templates with snapshot tests. Project data (memory, blueprint) is delimited and marked as data, never as instructions.

Role runs, tool loops and the planner/builder/reviewer prompts arrive from M5 on.
