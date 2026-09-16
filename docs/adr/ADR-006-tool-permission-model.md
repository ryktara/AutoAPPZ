# ADR-006: Tool permission model

**Status:** Accepted · **Date:** 2026-09-16

## Context
Per-tool-name consent (`ask/always/never`) is coarse: "always allow write_file" is unbounded. Privileged tools need scope, audit, cancellation and timeouts.

## Decision
- Every tool declares a `PermissionDescriptor {capability, risk, scope(input), defaultPolicy}`.
- Policy decisions: `ask | allow-once | allow-session | allow-project | deny`, stored per `(projectId?, capability, scopePattern)` in `packages/permissions`.
- Scope patterns: path globs (fs), command allowlists (shell), hosts (net), tables (db), remotes (git), deploy targets.
- Risk tiers drive UI: `destructive` operations always confirm unless an explicit project rule allows them; `high` shows a diff/preview; `low` may be auto-allowed by default policy.
- Audit entry per tool call with decision provenance (which rule), inputs (redacted), result summary, duration, ids.
- Consent requests carry deadlines and are cancellable; the agent receives a structured "denied/timeout" result.
- Plugins/MCP servers get capabilities only from their manifest and the same policy engine.

## Alternatives
Global auto-approve switch (reference legacy), per-tool only (reference agent), capability tokens per session only.

## Consequences
Richer consent UI; policy engine must be fast and well-tested (property tests for scope matching).

## Migration impact
None.
