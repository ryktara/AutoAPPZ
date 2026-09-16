# ADR-012: Workspace packages export TypeScript source; three typecheck projects

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** AutoAPPZ maintainers
- **Related:** ADR-011 (monorepo toolchain)

## Context

ADR-011 chose pnpm workspaces + strict TypeScript + Vitest + Vite/Forge. The remaining question was how packages
are consumed: pre-built `dist/` with TS project references, or raw `src/index.ts` resolved by the bundlers.

Every consumer of `@autoappz/*` is itself bundled (Vite for main/preload/renderer, Vitest/esbuild for tests). A
per-package build step would add a compile stage before any test or dev run, require `dist` to be kept in sync,
and slow the inner loop, with no runtime benefit because nothing is published to npm at this stage.

Two of the codebases need the DOM lib and JSX (`packages/ui`, `apps/desktop/src/renderer`); everything else must
**not** see DOM types so that main-side code cannot accidentally reference `window` or `document`.

## Decision

1. Each workspace package's `package.json` has `"exports": { ".": "./src/index.ts" }`. Bundlers and Vitest
   resolve TypeScript directly. `tsconfig.base.json` mirrors this with `paths` so `tsc` sees the same graph.
2. `pnpm typecheck` runs three `tsc --noEmit` projects:
   - root `tsconfig.json` — Node-only lib (`ES2023`), covers all main-side packages, `apps/desktop/src/{main,preload,shared}`, tools and tests;
   - `packages/ui/tsconfig.json` — adds `DOM`, `DOM.Iterable`, `jsx: react-jsx`, no Node types;
   - `apps/desktop/src/renderer/tsconfig.json` — same as ui plus `vite/client` types.
3. ESLint uses `projectService`, so each file is checked against its nearest `tsconfig.json`; the renderer and
   ui boundaries are additionally enforced with `no-restricted-imports`.
4. The Electron bundles are emitted as `main.cjs` / `preload.cjs` because the app package is `"type": "module"`;
   the renderer is an ESM Vite build.

## Consequences

- No build step to run tests or start the app in dev; `pnpm check` is typecheck + lint + format + unit tests.
- Publishing a package to npm later requires adding a build (tsup or `tsc -b`) and switching `exports`; the
  source layout does not need to change.
- Renderer code physically cannot typecheck against Node APIs, and main-side code cannot typecheck against DOM APIs.
- pnpm 11 policies are set in `pnpm-workspace.yaml`: `allowBuilds` for `electron`/`esbuild` postinstall scripts
  and `blockExoticSubdeps: false` because `@electron/rebuild` resolves `@electron/node-gyp` from a git URL.
