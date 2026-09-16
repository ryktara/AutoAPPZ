# Dashboard

React 19 + Vite analytics dashboard: sidebar navigation, KPI cards, a dependency-free SVG line chart and a sortable, filterable orders table. Sample data is deterministic (`src/data.ts`); replace it with your API.

- `pnpm install`
- `pnpm dev` — start the dev server
- `pnpm build` — typecheck and build to `dist/`
- `pnpm test` — unit tests

This project is a plain Vite application and has no dependency on the tool that generated it. A `Dockerfile` (nginx serving `dist/`) is included.
