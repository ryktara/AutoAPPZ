# ADR-007: Runtime Supervisor

**Status:** Accepted · **Date:** 2026-09-16

## Context
The reference runs `install && dev` as one shell string, infers readiness from stdout, kills whatever owns a port, and spreads process bookkeeping across modules.

## Decision
`packages/runtime` owns all project processes:
- Phases as separate supervised processes: `install`, `serve`, `build`, `test`, `script` — each with explicit state `STOPPED → STARTING → RUNNING → DEGRADED → CRASHED → RESTARTING → STOPPING`, `invocationId`, `AbortSignal`, timeouts, output ring buffers, exit classification.
- Spawn with argument arrays (`spawn(file, args)`; package manager resolved explicitly, `.cmd` handling on Windows), never `shell: true` for platform-built commands; user-defined custom commands run through a documented shell with explicit warning.
- **Port leases** from a reserved band per project; readiness by **HTTP health probe** (GET with timeout) after the URL is detected; never kill foreign PIDs — report the conflict and lease a different port.
- Crash backoff with jitter; restart limits; `DEGRADED` when health probes fail while the process lives.
- Preview proxy injects one small, versioned instrumentation script with explicit target origin; capture: startup failure, build failure, console errors, unhandled exceptions, failed network requests, blank screen (no root content after N s), health.
- Runtime profiles: `host` (default), `container` (Docker) — same state model.
- Structured runtime events feed the Runtime Observer and diagnostics extraction.

## Alternatives
Keep single shell chain (fast but opaque), PM2-style manager (extra process), only Docker (heavy for Makers).

## Consequences
More precise failures ("install failed at step X"); slightly more process overhead.

## Migration impact
None.
