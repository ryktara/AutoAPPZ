# ADR-014: Database integrations and destructive-SQL protection

**Status:** Accepted · **Date:** 2026-09-16

## Context

Generated apps need real databases (local PostgreSQL, Supabase, Neon). The agent must be able to read schemas and data to build features, yet the platform must never let a model run a statement that destroys user data, and connection secrets must never reach the renderer or the model.

## Decision

1. **One provider family, three adapters.** `packages/integrations` defines `DatabaseAdapter { connectionFor(config, secret), discover?(token) }`. Postgres (connection string or host fields + password), Supabase (project ref + database password; management API for discovery) and Neon (project/branch/endpoint + role password; API for discovery) only derive connection targets; all SQL goes through one `ProjectDatabase` gateway over `pg`.
2. **Secret-free records.** `integrations` rows hold `config` (host, ref, branch…) and a `secretId`; the value lives in the secrets service and is resolved inside the main process only. Discovery tokens are used once and never stored. Labels and logs use redacted connection strings.
3. **Static SQL classification gates execution.** `classifySql` blanks comments/strings, splits statements and classifies each as `read | write | ddl | destructive | unknown` (the most severe wins). Agent tools map to capabilities: `db.schema` and `db.query` use `db.query` (query asks once per session; only `read` statements run), `db.execute` uses `db.mutate` (asks; `write`/`ddl` only). **`destructive` is refused unconditionally** — DROP, TRUNCATE, DELETE/UPDATE without WHERE, ALTER … DROP — there is no policy that enables it for the agent; users run such statements themselves.
4. **Bounded execution.** Small pool per integration, 5 s connect timeout, 15 s statement timeout per connection, 500-row cap (200 for the model), parameters and rows never logged.
5. **Runtime injection.** The attached integration's connection string is injected as `DATABASE_URL` into project processes (install/dev/build/test) via the command planner; templates declare `env` requirements in `template.json` and fail fast with guidance when the variable is missing.
6. **Template contract.** `fullstack-postgres` (React + Vite, Hono API in the Vite dev server, Drizzle migrations, bcrypt cookie sessions, notes CRUD) is validated in CI against a PostgreSQL service: migrate → API tests → build, standing on its own without `@autoappz` dependencies.

## Alternatives

Per-row-level permission checks (needs a SQL parser and still misses functions/triggers); letting the model run destructive statements behind a consent prompt (consent fatigue makes the prompt meaningless for irreversible actions); ORM-only access for the agent (blocks legitimate schema inspection and ad-hoc reads).

## Consequences

The classifier is conservative: `DO`/`CALL`/`EXECUTE` are `unknown` and treated like writes; multi-statement scripts take the severity of their worst statement. Branch-per-task on Neon and Supabase pooler connections are deferred. UNVERIFIED: Supabase/Neon management API shapes are covered by mocked tests only.

## Migration impact

Migration `0005_integrations_fields` adds `name`, `secret_id`, `status_message` to `integrations`.
