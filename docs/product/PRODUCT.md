# AutoAPPZ — Product Definition

> **AutoAPPZ is a local-first, agentic software engineering environment capable of turning a product request into a tested, maintainable, production-ready application while keeping the generated application's source code fully owned and portable by the user.**

**Primary principle:** *The user owns the code. The platform orchestrates development but never becomes a required runtime dependency of generated applications.*

Working codename during design: "Forge". Product name: **AutoAPPZ**. Package scope: `@autoappz/*`. Protocol scheme: `autoappz://`. Default projects directory: `~/autoappz-projects/`.

---

## 1. Who it is for

| Persona | Need | What must be true |
|---|---|---|
| **Maker** (non-technical founder/PM) | "Build me a restaurant ordering platform" and get something real, not a landing page | Guided product blueprint; no terminals; failures explained with one next action; deploy-ready output |
| **Builder** (semi-technical, BYOK) | Fast iteration with own keys/local models; wants to see diffs, run tests, push to GitHub | Inspectable plans/changes/validation; git-native; provider independence; cost visibility |
| **Engineer** (professional) | Use it on existing repos as a serious agent; trust its edits; keep their toolchain | Existing-repo import without copying; conflict-safe edits; permission scopes; terminal; IDE coexistence |
| **Team lead / reviewer** | Understand what the agent did and why | Task records with plan, evidence, diffs, validation, audit log |

Detailed personas in `PERSONAS.md`.

## 2. Product principles (binding)

1. **Local first** — projects are plain folders and git repositories; the platform stores its own state outside the repo.
2. **Provider independent** — OpenAI, Anthropic, Google, xAI, OpenAI-compatible, Ollama and local inference through one adapter interface with capability descriptors; no vendor-hosted "engine".
3. **Portable output** — generated projects run with `pnpm install && pnpm dev` and deploy anywhere without AutoAPPZ; no platform packages in `dependencies`/`devDependencies`; preview instrumentation is injected at serve time only.
4. **Git is a primitive** — every consequential agent operation can create a checkpoint; user work is never destroyed.
5. **Inspectable AI** — plan, affected files, tool calls, diffs, validation evidence are first-class UI objects; private chain-of-thought is never shown, concise execution summaries are.
6. **Safe autonomy** — permission policies `Ask / Allow once / Allow for session / Allow for project / Deny`, scoped by capability and target, audited.
7. **Failure recovery** — every long-running workflow supports cancel, retry, resume where safe, rollback and diagnostics.
8. **No dead ends** — every failure states what failed, likely cause, what the system will try, what the user can do.
9. **Production, not demo-ware** — generated apps ship with strict TypeScript, lint, tests, env config, migrations, deployment config, error handling, accessibility and a security baseline.
10. **Extensible** — providers, databases, deployers, templates, tools, validators and MCP servers are adapters/plugins behind capability-based permissions.

## 3. Core concepts (domain model)

| Concept | Definition |
|---|---|
| **Workspace** | The platform install: settings, provider credentials (secrets service), project catalog |
| **Project** | A folder + git repository registered in the catalog; has a **Blueprint**, **Memory**, **Integrations**, **Runtime profile** |
| **Blueprint** | Structured product spec (users, roles, pages, navigation, entities, data model, auth, integrations, API, design system, deployment, tests, acceptance criteria) — persisted, versioned, evolves with the app |
| **Task** | One unit of agent work driven by a request; passes through an explicit state machine (`UNDERSTAND → EXPLORE → PLAN → AWAIT_APPROVAL → EXECUTE → VALIDATE → (DIAGNOSE → REPAIR)* → REVIEW → CHECKPOINT → COMPLETE`); owns a plan, tool-call log, change set, validation report, checkpoint and cost record |
| **Requirement / Acceptance criterion** | Traceable IDs (`REQ-nnn`, `AC-n`) attached to Blueprint items and Tasks; the Reviewer validates against them |
| **Checkpoint** | Git-native snapshot (before/after refs) with metadata; supports undo, per-file restore, compare, branch-from, continue-from |
| **Session** | A conversation/thread of tasks on a project (the narrative), distinct from durable Project Memory |
| **Project Memory** | Distilled facts: architecture decisions, conventions, design rules, database decisions, preferences, known issues, rejected approaches, integrations |
| **Runtime** | Supervised processes for a project: install, dev server, build, tests; explicit states `STOPPED/STARTING/RUNNING/DEGRADED/CRASHED/RESTARTING/STOPPING` |
| **Integration** | Adapter instance bound to a project (database, deployment, VCS remote, MCP server) with readiness status |
| **Tool** | Typed, permissioned capability the agent can invoke |

## 4. Scope by horizon

**First vertical slice (must be excellent before breadth):** install → create project (React+Vite+TS template) → prompt → plan → approval → files generated → dependencies installed → app runs → preview → runtime error detected → AI fixes → validation passes → checkpoint → reopen later. Providers: OpenAI, Anthropic, Google, Ollama/OpenAI-compatible. Git local only.

**Then:** blueprint-driven full-app generation (restaurant-class scope), context engine, repair loops, code intelligence, GitHub, Postgres/Supabase/Neon, Vercel/Netlify/Cloudflare/Docker, MCP, plugin SDK, cost dashboards, evals.

**Explicitly out of scope for v1:** hosted cloud sandboxes, remote SSH machines, mobile shells, visual editing/annotation, marketplace.

## 5. Success metrics (measurable; methodology in `docs/performance/BENCHMARKS.md` and `REFERENCE-VS-OURS.md`)

- Reliability: ≥95% recovery on the injected-build-error eval suite within bounded attempts.
- Safety: 100% of privileged tools pass schema + permission validation and emit audit entries (enforced by tests).
- Portability: generated projects contain zero `@autoappz/*` dependencies; CI builds them standalone.
- Undoability: undo never loses pre-existing uncommitted user edits (property test).
- Context quality: large-project tasks send ≤ budget tokens with ≥ target recall on the retrieval benchmark.
- Performance: project open < 1 s cold catalog, index warm-up in background; first token < provider latency + 300 ms overhead.
- Testing: critical journeys covered by deterministic integration/E2E tests on macOS, Windows and Linux.
- Maintainability: package boundaries enforced by lint rules; no cross-layer imports.

## 6. Non-goals and principles we deliberately do not copy

- No proprietary "pro" tier gating core intelligence; no vendor engine in the hot path.
- No XML pseudo-tool protocol; native tool calling only.
- No chat-with-modes UI; one agent with explicit task phases.
- No secrets in the renderer; no unvalidated IPC.
- No copying of the user's repository into a managed folder by default (import in place; optional copy).
