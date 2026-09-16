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
