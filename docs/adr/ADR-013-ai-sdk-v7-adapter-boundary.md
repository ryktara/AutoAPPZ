# ADR-013: AI SDK v7 behind a single adapter module; no vendor SDKs elsewhere

- **Status:** Accepted
- **Date:** 2026-09-16
- **Related:** ADR-005 (provider abstraction)

## Context

ADR-005 chose the Vercel AI SDK as transport. At implementation time the SDK is at major version 7 with a
`LanguageModelV4` stream vocabulary (`text-delta`, `reasoning-delta`, `tool-call`, `finish` with detailed
usage, `error`, `abort`). Provider packages differ in version cadence (`@ai-sdk/openai` 4.x, `@ai-sdk/xai` 5.x,
`@ai-sdk/openai-compatible` 3.x) and the SDK deprecates surface area between majors (`fullStream` → `stream`).

## Decision

1. `packages/ai-providers/src/sdk.ts` is the only file that imports `ai` or any `@ai-sdk/*` package. It exposes
   `createLanguageModel(kind, config, modelId)` and `streamChat(model, request, signal)` returning our own
   `ChatChunk` vocabulary. Everything else — registry, router, agent loop, UI — depends on `ChatChunk` only.
2. Tools are passed to the SDK **without** `execute`; the SDK never runs a tool. Tool execution belongs to the
   agent loop under the permission engine (M5). Tool results are sent back as `role: "tool"` messages.
3. Ollama is driven through its OpenAI-compatible `/v1` endpoint via `@ai-sdk/openai-compatible`, avoiding a
   third-party community provider package. Discovery still uses Ollama's native `/api/tags`.
4. Transport retries (`maxRetries`, default 2 for 429/5xx) live in the adapter; semantic retries (different model,
   repair) belong to the orchestrator.
5. Contract tests exercise the real SDK against the fake OpenAI-compatible server so SDK upgrades are caught by
   tests rather than at runtime.

## Consequences

- Upgrading or replacing the SDK touches one module plus the contract test.
- Provider quirks are expressed as data in `PROVIDER_DEFINITIONS` (auth header style, discovery endpoint, base URL
  support), not as separate code paths.
- Capabilities and pricing in the catalog are curated estimates (`CATALOG_VERSION`) and labelled as such in the UI.
