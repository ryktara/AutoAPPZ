# ADR-005: Model provider abstraction and routing

**Status:** Accepted · **Date:** 2026-09-16

## Context
No architecture may depend on one vendor; local inference must be first-class; routing must be explainable and user-overridable.

## Decision
- `ModelProvider` interface in `packages/ai-providers` with adapters for OpenAI, Anthropic, Google, xAI, OpenAI-compatible (covers OpenRouter, LM Studio, vLLM, etc.) and Ollama.
- Transport implemented with the **Vercel AI SDK** (Apache-2.0) behind the adapter; only `ai-providers` imports it, so it can be swapped.
- **Capability descriptors** per model (`reasoning, fast-edit, vision, large-context, tool-calling, local, inexpensive, json-mode`, context window, max output, pricing) from a versioned catalog + provider discovery + user overrides.
- `ModelRouter` chooses per role/complexity with policies (privacy=local-only, latency, cost, user choice); explicit user selection always wins; every call records the routed model and estimated cost.
- No vendor-hosted "engine": smart context, edits and consent classification are local.

## Alternatives
Direct provider SDKs (more code, less uniform streaming/tool semantics); LiteLLM-style proxy (extra process).

## Consequences
Provider quirks (tool-result ordering, reasoning tokens) handled in adapters with contract tests against recorded fixtures.

## Migration impact
None.
