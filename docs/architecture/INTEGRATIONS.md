# Integration Hub (`packages/integrations`, `packages/ai-providers`)

Integrations never contaminate the core domain model: the core knows `Integration {kind, adapterId, config, status}`; adapters implement typed interfaces.

```ts
interface ModelProvider { id; models(): Promise<ModelDescriptor[]>; validateCredentials(secret: SecretRef): Promise<ValidationResult>; chat(req: ChatRequest, ctx): AsyncIterable<ChatChunk>; }
interface DatabaseProvider { id; connect(config, secrets): Promise<DbHandle>; introspect(handle): Promise<SchemaSnapshot>; execute(handle, sql, {classification}): Promise<Result>; migrations(handle): MigrationOps; branches?(handle): BranchOps; }
interface DeploymentProvider { id; detectFramework(project): FrameworkInfo; readiness(project): ReadinessReport; deploy(project, target, ctx): AsyncIterable<DeployEvent>; deployments(target): Promise<Deployment[]>; }
interface VcsProvider { id; auth(ctx): Promise<SecretRef>; repos(); createRepo(); connect(project, repo); push(project, opts, ctx); pullRequests?(); }
interface McpClient { connect(config): Promise<McpSession>; listTools(); callTool(name, input, {consent}): Promise<ToolResult>; }
interface TemplateSource { id; list(): Template[]; materialize(template, targetDir): Promise<void>; }
interface Validator { id; costTier; applicableTo(changeSet); run(ctx): Promise<Diagnostic[]>; }
```

Adapters planned: providers (OpenAI, Anthropic, Google, xAI, OpenAI-compatible, Ollama), databases (Postgres, Supabase, Neon), deployment (Vercel, Netlify, Cloudflare, Docker), VCS (GitHub), MCP (stdio/http + OAuth PKCE loopback). Each adapter ships contract tests with recorded fixtures and a mock server for E2E.

Credentials: adapters receive `SecretRef`s and resolve them through the secrets service inside the main process; tokens never leave the process except to the provider's own API.

## Implementation notes — databases (M11)

Canonical decision: `docs/adr/ADR-014-database-integrations.md`.

- `packages/integrations`: `classifySql` (read/write/ddl/destructive/unknown with reasons), adapters `postgresAdapter`, `supabaseAdapter`, `neonAdapter` (`connectionFor`, optional `discover`), `ProjectDatabase` gateway (`test`, `introspect` over information_schema/pg_indexes/pg_class, `execute(sql, allowedKinds, params)` with row cap and error mapping, `close`), `createPgExecutor` (pg Pool, statement timeout) with an injectable executor so tests run on PGlite, `createDatabaseTools` (`db.schema`, `db.query`, `db.execute`) and `renderSchema`.
- Desktop: `integrations-wiring.ts` owns the repository, secret resolution, one cached gateway per integration, handlers (`integrations.adapters/list/upsert/delete/test/discover`, `db.introspect`) and `databaseUrlFor(projectId)` used by the runtime command planner to inject `DATABASE_URL`. The Project tab's **Database** card configures, tests, attaches, discovers (Supabase/Neon) and shows the schema.
- Storage: migration `0005_integrations_fields`; `IntegrationsRepository`. Project settings gain `databaseIntegrationId`.
- Template manifests gain `runtime.migrate` and `env[]`; `fullstack-postgres` is verified in CI against a PostgreSQL service (`template-postgres` job).
- Deferred: deployment/VCS/MCP adapters (M12/M13), Neon branch-per-task, per-table permission scopes, a SQL console in the UI.

## Implementation notes — deployment (M12)

Canonical decision: `docs/adr/ADR-015-deployment-adapters.md`.

- `packages/integrations/src/deployment`: `detectFramework` (vite / nextjs (+ static export) / node server / static / unknown, output dir, package manager), `collectFiles` + `digest` (caps, never dependencies, VCS data or secret files), `renderDockerfile`, `buildReadiness`, provider adapters `vercelAdapter` (source upload), `netlifyAdapter` and `cloudflareAdapter` (prebuilt output upload), `createDockerAdapter` (local image). Shared process helpers (`runCommand`, `resolveProjectBin`) moved to `@autoappz/runtime`.
- Desktop: `deployment-wiring.ts` — targets and deployments repositories, env requirements (template `env[]` + `DATABASE_URL` from the attached database + per-target secrets), readiness (with git status and the latest validation), one running deployment at a time, live event journal with replay from the persisted record, handlers (`deploy.adapters/targets/upsertTarget/deleteTarget/setEnv/discover/readiness/run/cancel/history`, stream `deploy.events`). The Project tab's **Deploy** card manages targets, env values, the checklist, live logs and history.
- Templates: `nextjs` (App Router, Vitest) and `dashboard` (KPIs, SVG chart, sortable table) added; every template ships the `Dockerfile`/`.dockerignore` the Docker target generates; CI runs the portability check for all four and builds each image (`docker-build` job).
- Deferred: `saas` template (needs the payments integration design), registry push for Docker images, deployment logs beyond 100 kB, provider-side build logs, GitHub VCS adapter (M13/M14).
