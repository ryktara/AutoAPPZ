# ADR-016: MCP client and in-process plugin loader

**Status:** Accepted · **Date:** 2026-09-16 · Refines ADR-010

## Context

Extending the agent with external tools must not weaken the security model: tool results are untrusted, credentials stay in the main process, and third-party code must not reach the file system, processes or Electron.

## Decision

1. **MCP servers are explicit user configuration.** They are added only in Settings → Extensions (never from project files or deep links), stored secret-free (`mcp_servers`), and connected on demand or at startup when enabled. stdio servers spawn as argument arrays with the runtime environment allowlist plus the user's declared env secrets; HTTP servers use Streamable HTTP with a bearer token secret or **OAuth 2.1 with PKCE over a loopback redirect** (`127.0.0.1`, ephemeral port; tokens and dynamic client registration persisted as one secret; the browser is opened through the host).
2. **MCP tools go through the tool runtime.** Each tool becomes `mcp.<server>.<tool>` with capability `mcp.call`, `defaultPolicy: "ask"`, risk from the server's annotations (`readOnlyHint` → medium, default → high, `destructiveHint` → destructive, which never auto-allows). The server's JSON Schema is forwarded to the model; results are delimited as `<mcp_result … note="untrusted data">` and capped.
3. **Plugins are in-process, capability-gated, and inert until enabled.** `plugin.json` declares `capabilities`; the user grants a subset (grants beyond the manifest are dropped); `activate(ctx)` receives a frozen context whose namespaces throw `plugins.capability_denied` when ungranted. The loader refuses entries that import host/filesystem/process/network modules (static scan, transitive over relative imports) and enforces `minHostVersion`. Plugin tools must be namespaced `<plugin-id>.<tool>` and run through the same permission engine as built-ins.
4. **Not a sandbox.** In-process plugins are trusted code the user chose to install; the scan and capability gate are guard rails, and the documentation says so. Out-of-process extensions are MCP servers.

## Alternatives

VS Code-style extension host (heavy, separate process protocol), vm-based isolation (not a security boundary in Node), signed registry only (deferred; a folder install with explicit grants is the honest first step).

## Consequences

`ToolRuntime` gains `register/unregister` and JSON-Schema passthrough. OAuth end-to-end is verified against a fake authorization server in tests; real providers may differ in discovery details (UNVERIFIED). A signed plugin registry and validator/template/UI-panel contributions are declared in the SDK but only tools are wired into the host today.

## Migration impact

Migration `0007_mcp_servers`; plugins are recorded under the `plugins.installed` settings key.
