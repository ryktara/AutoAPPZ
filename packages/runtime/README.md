# @autoappz/runtime

Runtime Supervisor (ADR-007, `docs/architecture/RUNTIME.md`).

- `RuntimeSupervisor` — one supervised child process per phase (`install`, `serve`, `build`, `test`) with explicit state (`STOPPED → STARTING → RUNNING → DEGRADED → CRASHED → RESTARTING → STOPPING`), argument-array spawning, env allowlist, bounded output ring (5k lines), phase timeouts, HTTP readiness probe, periodic health probes (→ `DEGRADED`), crash backoff with jitter-free doubling and a restart cap, and process-tree termination (`taskkill /T` on Windows, process groups on POSIX). Foreign listeners on a port are skipped, never killed. Dev servers that ignore the leased port are detected from their own output and adopted.
- `command.ts` — package-manager detection; `.cmd` shims resolved to `node <entry>` so nothing runs through cmd.exe; `buildChildEnv` allowlist with non-interactive defaults.
- `ports.ts` — reserved bands (serve 41000–41999, proxy 42000–42999) and leases.
- `diagnostics.ts` — tsc / pnpm / npm / vite / node output parsers (golden-tested).
- `proxy.ts` — loopback reverse proxy for the preview: injects one versioned instrumentation script into HTML (errors, unhandled rejections, console error/warn with a budget, failed fetches, navigation, blank screen), forwards WebSocket upgrades (HMR). The renderer validates `event.source`/`event.origin` before forwarding events.
