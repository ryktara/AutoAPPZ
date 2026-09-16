# ADR-011: Monorepo and toolchain

**Status:** Accepted · **Date:** 2026-09-16

## Context
Package boundaries must be real; the toolchain must be boring and fast on macOS, Windows and Linux.

## Decision
- **pnpm workspaces** with TypeScript **project references**; `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedLocals/Parameters` on everywhere; `any`/`@ts-ignore` forbidden by lint except with a justification comment.
- **ESLint** (typescript-eslint, import boundaries via `eslint-plugin-boundaries`) + **Prettier** for formatting; a single `pnpm check` runs typecheck, lint, format, unit tests.
- **Vitest** for unit/integration; **Playwright** for E2E (Electron); custom eval runner in `packages/testing`.
- Node LTS pinned via `.nvmrc`/`engines`; `corepack` for pnpm.
- Electron Forge + Vite for the desktop app; changesets for versioning; conventional commits.
- CI: lint/typecheck/unit on ubuntu; integration + E2E matrix on ubuntu, windows, macos; nightly evals; release workflow with provenance.

## Alternatives
Turborepo/Nx (add later if build times demand), Biome (fewer boundary rules today).

## Consequences
Standard tooling; explicit boundary enforcement.

## Migration impact
None.
