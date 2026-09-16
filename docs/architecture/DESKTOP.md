# Desktop Host (`apps/desktop`)

## Processes
- **Main**: bootstraps `packages/diagnostics` (logging with `sessionId`), `packages/storage` (DB + migrations with pre-migration backup), `packages/secrets`, `packages/command-bus` (Electron transport), then the Orchestration Core and services. Handlers register through the bus only.
- **Preload**: exposes `window.autoappz = { send, onMessage, hello, version }` — an opaque message pipe on a single fixed channel plus a one-time handshake that returns `{ sessionId, subscriptionToken, peerId }`. No `ipcRenderer` passthrough and no channel names reach the renderer; the typed API (`dispatch`, `stream`, `on`, cancel) is the `CommandBusClient` from `packages/command-bus`, which validates every wire message against `WireMessageSchema`.
- **Renderer**: React app from `packages/ui`; depends only on `packages/contracts` types. `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- **Workers**: Context index worker (`utilityProcess`), validator runners (child processes), preview proxy (`worker_threads`).

## Window security
- CSP: `default-src 'self'; script-src 'self'; connect-src 'self' <dev origin in dev>; img-src 'self' data: autoappz-media:; frame-src http://127.0.0.1:* http://localhost:*` (preview iframes only), `object-src 'none'`, `base-uri 'none'`.
- Navigation: main-frame navigation only to the packaged `index.html` or dev origin; all `window.open` denied except HTTP(S) preview popups re-created with hardened options.
- Trusted-frame check on every command: sender frame is the main frame of a registered window and its URL is the packaged renderer or dev origin (`apps/desktop/src/main/security.ts`, unit-tested; the transport attaches `PeerInfo.trusted` and the bus drops untrusted traffic).
- Protocol `autoappz://` for OAuth loopback completion and deep links; payloads validated; queued until a window is ready; ignored during shutdown.
- Media served through `autoappz-media://` with project-id scoping and size caps.

## Lifecycle
`ready → bootstrap → create window → restore session` / `before-quit → stop runtimes (bounded) → flush journals → close DB → quit`. Crash sentinel + renderer crash record enable next-launch diagnostics (opt-in telemetry).

## Auto-update
Electron autoUpdater with GitHub releases feed and signed builds; stable/beta channels; never auto-restart while a task is executing.

## Multi-window
Deferred; the bus already scopes subscriptions per window so a second window is additive.
