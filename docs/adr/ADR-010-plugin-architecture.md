# ADR-010: Plugin / extension architecture

**Status:** Accepted · **Date:** 2026-09-16

## Context
Providers, deployers, databases, templates, tools, validators and MCP servers must be addable without touching the core, and without exposing Electron APIs.

## Decision
- **Adapters** (first-party, in-repo) implement interfaces in `packages/integrations`, `packages/project`, `packages/validation`, `packages/tools`.
- **Plugins** (third-party) ship a manifest `{id, version, capabilities[], contributes: {providers?, tools?, templates?, validators?, deployers?, databases?, mcpServers?}}` and run either **in-process** (trusted, installed from a signed registry, restricted to the SDK surface — no `electron`/`fs`/`child_process` imports enforced by the loader) or **out-of-process** (MCP-style, over stdio/HTTP) with the same capability grants.
- Capabilities map to the permission engine (ADR-006); the user grants them at install time and can revoke.
- The SDK exposes typed services only (`ctx.fs` scoped to the project, `ctx.http` with host allowlists, `ctx.secrets` by reference, `ctx.runtime` with limits).

## Alternatives
VS Code-style extension host (heavy), unrestricted Node plugins (unsafe).

## Consequences
Plugin SDK is versioned with semver contracts and compatibility tests; MCP is the default out-of-process protocol.

## Migration impact
None.
