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
