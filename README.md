# AutoAPPZ

**A local-first, agentic software engineering environment** that turns a product request into a tested, maintainable, production-ready application — while the generated code stays fully yours and runs without AutoAPPZ.

> Status: **M0–M14 implemented** — see `docs/STATUS.md` for what is verified locally, in CI only, or explicitly deferred. Plan: `IMPLEMENTATION-PLAN.md`.

## Principles
Local first · Provider independent · Portable output · Git as a primitive · Inspectable AI · Safe autonomy · Failure recovery · No dead ends · Production, not demo-ware · Extensible.

## What it does (target)
1. You describe a product. 2. AutoAPPZ builds a **Blueprint** (pages, entities, roles, auth, integrations, acceptance criteria) you approve. 3. An agent plans, edits your project with permissioned tools, **validates** (types, lint, tests, build, runtime), **repairs** within bounds, **reviews** against your criteria and **checkpoints** in git. 4. You watch the plan, tool activity, diffs and validation evidence — not a chat log — with a live preview that feeds runtime errors back to the agent.

## Getting started

```bash
pnpm install
pnpm dev          # Electron app with Vite dev server
pnpm check        # typecheck, lint, format, unit + security tests
pnpm test:e2e     # Playwright driving the real Electron app (needs `pnpm build` first)
pnpm bench        # performance benchmarks against docs/performance/BENCHMARKS.md targets
```

See `docs/development/SETUP.md` for toolchain notes (Node 24, pnpm 11, bundled git, ripgrep, SQLite prebuilds).

## Documentation
- Product: `docs/product/PRODUCT.md`, `PERSONAS.md`, `USER-FLOWS.md`, `ROADMAP.md`, `REFERENCE-VS-OURS.md`
- Architecture: `docs/architecture/OVERVIEW.md` (start here), `docs/design/*`, `docs/adr/*`
- Security: `docs/security/*`, `docs/design/THREAT-MODEL.md`
- Development: `docs/development/*` (SETUP, TESTING, DEBUGGING, RELEASE); status: `docs/STATUS.md`; benchmarks: `docs/performance/BENCHMARKS.md`
- Reference analysis (clean-room reverse engineering of an existing product): `docs/reference/*`, `docs/legal/REFERENCE-LICENSE-AUDIT.md`, `REVERSE-ENGINEERING-REPORT.md`

## License
Apache-2.0 — see `LICENSE` and `NOTICE`. This project reuses no code, prompts, assets or branding from any reference product; see `docs/legal/REFERENCE-LICENSE-AUDIT.md`.
