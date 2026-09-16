# Full-stack + PostgreSQL

React 19 + Vite frontend, a Hono API served from the same dev server under `/api`, Drizzle ORM with SQL migrations, cookie-session authentication (bcrypt) and a per-user notes CRUD.

- `pnpm install`
- `DATABASE_URL=postgresql://user:password@localhost:5432/app pnpm dev` — applies migrations, then starts the dev server (API + UI on one port)
- `pnpm build` — typecheck and build the frontend to `dist/`
- `pnpm start` — production server (API + built frontend) on `PORT`
- `pnpm test` — unit tests; the API integration tests run when `DATABASE_URL` is set
- `pnpm db:generate` — generate a migration after editing `server/schema.ts`; `pnpm db:migrate` applies pending migrations

Local PostgreSQL with Docker: `docker run --name app-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=app -p 5432:5432 -d postgres:16`

This project is a plain Vite + Hono application and has no dependency on the tool that generated it.
