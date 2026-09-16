# Development Setup

## Prerequisites
- Node.js LTS (see `.nvmrc`), `corepack enable` (pnpm version pinned in `package.json#packageManager`).
- Git ≥ 2.40, Python 3 + C/C++ toolchain for native modules (`better-sqlite3`, `node-pty`): Xcode CLT on macOS, Visual Studio Build Tools on Windows, `build-essential` on Linux.
- Docker (optional) for the container runtime profile and local Postgres tests.

## Bootstrap
```bash
pnpm install
pnpm check          # typecheck + lint + format + unit tests
pnpm dev            # starts the desktop app with the Vite dev server
```

## Layout
See `docs/design/SYSTEM-ARCHITECTURE.md §2`. Each package builds with project references; `pnpm -r build` emits `dist/` for packages consumed by the desktop app.

## Data directories (dev)
`AUTOAPPZ_DATA_DIR` overrides the userData path so dev runs never touch your real profile (`.autoappz-dev/` in the repo, git-ignored).

## Fake providers
`pnpm fake:model` starts the fake model server used by integration/E2E tests; set `AUTOAPPZ_MODEL_BASE_URL` to point the app at it.

## Common problems
- Native rebuild failures → `pnpm rebuild` after switching Node versions; the desktop app rebuilds natives for Electron during `pnpm dev`.
- Windows long paths → enable `git config core.longpaths true`.

## Toolchain notes (M0)

- Node 24 (`.nvmrc`), pnpm 11 (`packageManager` field; run `corepack enable` if `pnpm` is missing).
- `pnpm-workspace.yaml` carries pnpm policy: `allowBuilds` (electron, esbuild postinstall) and
  `blockExoticSubdeps: false` (Electron Forge's rebuild dependency is resolved from git). See ADR-012.
- Packages export TypeScript source; there is no per-package build. `pnpm check` = typecheck (3 projects) +
  lint + prettier + unit tests. `pnpm clean-room:check` greps for reference-product identifiers.
- Desktop: `pnpm dev` (Forge + Vite HMR) or `pnpm build && pnpm test:e2e` (Playwright drives the built app;
  set `AUTOAPPZ_DATA_DIR` to isolate state).
- If Electron's postinstall is interrupted you will see "Electron failed to install correctly": delete
  `%LOCALAPPDATA%/electron/Cache` (or `~/.cache/electron`) and re-run `pnpm install`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `AUTOAPPZ_DATA_DIR` | Platform data directory (database, secrets vault, logs). Defaults to Electron `userData`. |
| `AUTOAPPZ_PROJECTS_DIR` | Default parent directory for new projects; overrides the setting. Used by e2e/CI to keep the home directory untouched. |
| `AUTOAPPZ_LOG_LEVEL` | `trace` … `error`; default `debug` in dev, `info` when packaged. |
| `AUTOAPPZ_FAKE_MODEL` | (M3+) route model calls to the deterministic fake server. |
