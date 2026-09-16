# Architecture Overview (start here)

AutoAPPZ is a local-first, agentic software engineering environment. Read in this order:

1. `docs/product/PRODUCT.md` — what we are building and why.
2. `docs/design/SYSTEM-ARCHITECTURE.md` — layers, packages, boundaries.
3. `docs/adr/` — the decisions and their trade-offs.
4. This folder — engineering-level contracts per subsystem:
   - `DESKTOP.md` — Electron host, windows, preload, security posture.
   - `COMMAND-BUS.md` — commands/queries/events/streams, envelopes, errors, cancellation.
   - `AGENT.md` — task state machine, roles, prompts, tools, budgets.
   - `CONTEXT.md` — index and retrieval contracts.
   - `RUNTIME.md` — process supervision, ports, health, preview instrumentation.
   - `DATABASE.md` — platform schema and migrations.
   - `GIT.md` — checkpoints, undo, diffs.
   - `INTEGRATIONS.md` — adapter interfaces (providers, databases, deployment, VCS, MCP).
5. `docs/security/` — threat model, permissions, secrets.
6. `docs/development/` — setup, testing, debugging, release.
7. `IMPLEMENTATION-PLAN.md` — milestones and acceptance criteria.

Mental model in one line: **UI dispatches typed commands → Orchestration Core runs persisted task state machines → Agent roles call permissioned Tools → Tools use Runtime/Git/Context/Integrations → everything is journaled, audited, and checkpointed in git.**

Invariants every contributor must keep:
- The renderer never touches Node, files, processes, git or secrets.
- Every privileged tool has schema, scope, permission, audit, cancellation and timeout.
- Generated projects never depend on `@autoappz/*`.
- User work is never destroyed: checkpoints before consequential operations.
- Long-running operations define cancel, retry, idempotency, concurrency policy, error classification and recovery.
