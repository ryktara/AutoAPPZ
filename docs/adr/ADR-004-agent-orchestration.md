# ADR-004: Agent orchestration

**Status:** Accepted · **Date:** 2026-09-16

## Context
The reference runs everything through one tool loop per chat mode with model-initiated verification and no explicit task lifecycle; "done" is not defined by criteria.

## Decision
- **Native tool calling only**; no XML pseudo-tools.
- An explicit, persisted **task state machine** (`UNDERSTAND → EXPLORE → PLAN → AWAIT_APPROVAL → EXECUTE → VALIDATE → DIAGNOSE/REPAIR → REVIEW → CHECKPOINT → COMPLETE`, plus `CANCELLED`, `NEEDS_USER`, `INTERRUPTED`).
- **Roles as strategies** (Planner, Explorer, Architect, Builder, Validator, Debugger, Reviewer, Runtime Observer) selected by a complexity profile; trivial tasks use one model sequence.
- Mandatory **validation after execution** with cheapest-first checks and a **bounded repair loop** (default 3 rounds).
- **Requirements traceability**: acceptance criteria per task; Reviewer produces a criteria matrix.
- Read-before-write and hash-based optimistic concurrency enforced by the tool layer.

## Alternatives
Single loop with prompt-only verification (reference); multi-agent frameworks with fixed pipelines (expensive for trivial tasks).

## Consequences
More machinery in `packages/core`/`agent`; predictable recovery; evaluation harness measures repair success.

## Migration impact
None.
