# Runtime Supervisor (`packages/runtime`)

Canonical decision: `docs/adr/ADR-007-runtime-supervisor.md`.

## Model
```ts
type Phase = "install"|"serve"|"build"|"test"|"script";
type ProcessState = "STOPPED"|"STARTING"|"RUNNING"|"DEGRADED"|"CRASHED"|"RESTARTING"|"STOPPING";
interface RuntimeProcess { id; projectId; phase; state; invocationId; pid?; command: { file; args; cwd; env: EnvAllowlist }; port?: PortLease; startedAt?; exit?: { code; signal; classified: "clean"|"error"|"killed"|"timeout" }; health?: { lastOkAt; failures } }
```
Events: `runtime.stateChanged`, `runtime.output` (batched, ring buffer 5k lines/phase), `runtime.health`, `runtime.diagnostic` (structured, from parsers for pnpm/npm/vite/next/tsc/playwright outputs).

## Rules
- Argument-array spawning; package manager resolved explicitly (`pnpm`, `npm`, `yarn`, `bun` detection by lockfile/`packageManager`); Windows `.cmd` shims resolved without `shell: true`.
- Env allowlist: `PATH` (managed toolchain prepended), `HOME`, locale, `NODE_ENV`, project `.env` handled by the project's own tooling (not injected by us), never platform secrets.
- Port leases: reserved band `41000–41999` for serve, `42000–42999` for proxy; lease registry in memory + DB; conflict → next free port, never kill.
- Readiness: URL detected from output **and** HTTP probe 200/3xx/4xx (any response) within timeout; `DEGRADED` after 3 consecutive probe failures.
- Termination: SIGTERM → wait 5 s → SIGKILL to the process tree (job objects on Windows, process groups on POSIX); confirm port released.
- Backoff on crash: 1 s, 2 s, 4 s … max 30 s; max 5 auto-restarts per 10 min then `CRASHED` with guidance.
- Timeouts: install 15 min, build 10 min, test 20 min, serve startup 3 min (configurable).
- Container profile: same API via Docker with volume mounts and resource limits (`--memory`, `--cpus`).

## Preview
Proxy per project injects one script (`autoappz-preview.js`, versioned) that reports `error`, `unhandledrejection`, console entries (rate-limited), navigation, failed fetch/XHR (via wrappers, not a service worker), and a "no content painted" heuristic; `postMessage` uses the exact renderer origin; the renderer validates `event.origin` against the lease. No visual-editing or recorder scripts.

## Diagnostics extraction
Parsers produce `Diagnostic { source: "install"|"vite"|"next"|"tsc"|"playwright"|"runtime", severity, file?, range?, code?, message, stack?, command?, likelyCause? }` consumed by the Runtime Observer and the repair loop.

## Implementation notes (M7)

- `packages/runtime` implements the model above; the desktop composition root supplies a `CommandPlanner` (template manifest commands for bundled templates, otherwise `package.json` scripts with the detected package manager). Windows `.cmd` shims are resolved to `node <entry>`; nothing spawns with `shell: true`.
- Readiness: HTTP probe on the leased port; if the dev server prints a different `http://127.0.0.1:<port>/` it is probed and adopted (logged). The preview proxy attaches only after readiness.
- The renderer's strict CSP header is scoped to AutoAPPZ's own documents (`isAppUrl`); previewed apps keep their own headers so dev tooling (inline React refresh preamble) works. The preview iframe is sandboxed (`allow-scripts allow-same-origin allow-forms allow-modals`), loads only loopback proxy origins (`frame-src` restricted), and preview messages are accepted only from the iframe's own window/origin and validated against `PreviewEventSchema` before `runtime.reportPreviewEvent`.
- Not yet implemented: container profile (`runtime.profile_unsupported`), interactive terminal, `script` phase UI, per-phase log persistence across restarts.
