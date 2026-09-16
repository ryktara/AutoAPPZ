# @autoappz/ai-providers

Model provider abstraction (ADR-005).

- `types.ts` — `ModelProvider`, `ChatRequest`/`ChatChunk` (text, reasoning, tool-call, finish+usage, error), `ToolSpec` (JSON Schema).
- `sdk.ts` — the **only** module importing the Vercel AI SDK; maps `streamText` parts to `ChatChunk`. Tools carry no `execute`: the agent loop runs them under the permission engine.
- `providers.ts` — `PROVIDER_DEFINITIONS` (OpenAI, Anthropic, Google, xAI, OpenAI-compatible, Ollama) as data + one `GenericProvider` (REST discovery/validation, SDK chat). Ollama uses its `/v1` OpenAI-compatible endpoint.
- `catalog.ts` — curated capabilities + estimated pricing (`CATALOG_VERSION`); discovered models fall back to conservative defaults.
- `router.ts` — deterministic, explainable routing: global override → per-intent override → policy filters (local-only, tools, vision, context) → scoring.
- `registry.ts` — `ProviderRegistry`: settings store, per-call secret resolution (values never retained), discovery cache, validation, routing, usage recording with cost estimates.

Contract tests run against `@autoappz/testing`'s fake OpenAI-compatible server (streaming, tool calls, errors, cancellation).
