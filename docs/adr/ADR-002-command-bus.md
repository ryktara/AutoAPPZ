# ADR-002: IPC / command architecture — Typed Command Bus

**Status:** Accepted · **Date:** 2026-09-16

## Context
The reference has 383 channels defined as Zod contracts, but ~20 legacy handlers bypass validation, secrets are returned to the renderer, output validation is dev-only, and renderer-side orchestration duplicates main-side rules.

## Decision
- All renderer↔main interaction is expressed as **commands, queries, events and streams** declared once in `packages/contracts` with Zod schemas; handlers are registered only through the bus (`bus.handle(contract, fn)`); there is no raw `ipcMain.handle` outside the bus package (lint rule).
- Input and output validation always on (schemas are the DTOs).
- Standard envelope with `sessionId, projectId, requestId, correlationId`; typed `AppError` with `kind`.
- Cancellation (`AbortSignal`) and timeouts are bus primitives; streams carry `seq` and support ack-based backpressure for high-volume channels.
- **Secrets never cross the boundary**; contracts use `SecretRef`.
- Per-window subscription capability tokens; server-side interest tracking; disposal on window close.
- Transport-agnostic: Electron IPC adapter today, WebSocket adapter later.

## Alternatives
tRPC-over-IPC (extra abstraction, weaker control over envelopes/streams); GraphQL (overkill); ad-hoc channels (what we are avoiding).

## Consequences
Slight overhead for output validation (acceptable); one more package; strong test surface (contract tests generate fixtures).

## Migration impact
None.
