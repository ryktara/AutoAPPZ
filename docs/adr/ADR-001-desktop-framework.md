# ADR-001: Desktop framework

**Status:** Accepted · **Date:** 2026-09-16

## Context
The product needs a cross-platform desktop shell with an embedded browser preview, terminal (PTY), git, filesystem watching, child-process supervision and a rich React UI. The reference uses Electron 40 with a hardened boundary but no package separation.

## Decision
**Electron** (current stable major), with:
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, navigation/popup denial, trusted-frame IPC checks (see THREAT-MODEL).
- A **host-capability interface** (`packages/command-bus` transport abstraction) so the UI can later run against a WebSocket host (browser/remote) without touching feature code.
- Electron Forge + Vite for build/packaging; per-platform code signing; provenance attestations.
- Native modules limited to `better-sqlite3`, `node-pty`; git via bundled `dugite`; ripgrep via `@vscode/ripgrep`.

## Alternatives
- **Tauri (Rust core + webview):** stronger default isolation and smaller binaries, but the agent/tooling ecosystem (AI SDKs, git bindings, PTY, TypeScript language service, Node-based validators) is JS-native; a Rust core would force a bridge to Node anyway. Revisit when a Node sidecar pattern is acceptable.
- **Web app + local daemon:** attractive for remote/multi-device, but adds a service to install/secure; kept possible through the host interface.

## Consequences
Chromium footprint; must be disciplined about sandboxing and CSP; preload minimal.

## Migration impact
None.
