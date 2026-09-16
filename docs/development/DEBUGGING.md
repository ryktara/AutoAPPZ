# Debugging

## Ids
Every log line carries `sessionId projectId taskId agentRunId toolCallId processId` where applicable. Search by `taskId` to reconstruct a task end to end: journal (`task_events`), model calls (`agent_runs`), tool audit (`tool_calls`), runtime events, checkpoints.

## Logs
- Main: `<dataDir>/logs/main.log` (JSON lines, rotated), level via `AUTOAPPZ_LOG_LEVEL`.
- Renderer: DevTools console; errors forwarded to main with correlation ids.
- Runtime processes: per-phase ring buffers in the Logs dock; export to file.

## Diagnostic bundle
`Help → Export diagnostics` produces a zip with redacted logs, DB summaries (no secrets, no message contents unless opted in), runtime states, versions, and the last task's journal. Redaction is enforced by tests.

## Tips
- `pnpm dev --inspect` attaches the Node inspector to main.
- `AUTOAPPZ_FAKE_MODEL=1` routes all model calls to the fake server for reproducible agent runs.
- Task replay: `pnpm tools task:replay <taskId>` re-renders a task's journal in the terminal.
