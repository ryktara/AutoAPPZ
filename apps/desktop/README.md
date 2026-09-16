# @autoappz/desktop

Electron shell. `src/main` (composition root, hardened window, transport), `src/preload` (tiny bridge), `src/renderer` (React; only `@autoappz/contracts`, `@autoappz/command-bus` client and `@autoappz/ui`). See `docs/architecture/DESKTOP.md`.

- `pnpm dev` — Forge + Vite dev
- `pnpm build` — builds main/preload/renderer into `.vite/`
- `pnpm package` — packaged app in `out/`
