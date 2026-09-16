import type { CommandBusHost } from "@autoappz/command-bus";
import { AppError, integrations as contracts, workspace } from "@autoappz/contracts";
import type { Logger } from "@autoappz/diagnostics";
import {
  DATABASE_ADAPTERS,
  ProjectDatabase,
  createDatabaseTools,
  databaseAdapter,
  type SqlExecutorFactory,
} from "@autoappz/integrations";
import type { ProjectCatalog, ProjectSettingsService } from "@autoappz/project";
import type { SecretService } from "@autoappz/secrets";
import type { IntegrationsRepository } from "@autoappz/storage";
import type { AnyTool } from "@autoappz/tools";

type Integration = contracts.Integration;

export interface IntegrationsWiring {
  tools: AnyTool[];
  /** The attached database's connection string for the project's processes (DATABASE_URL), if any. */
  databaseUrlFor(projectId: string): Promise<string | undefined>;
  /** Attached database gateway for tools and introspection; undefined when none is attached. */
  databaseFor(projectId: string): Promise<ProjectDatabase | undefined>;
  close(): Promise<void>;
}

/**
 * Integration Hub wiring for databases: repository + secrets + adapters + one cached gateway per
 * integration. Secrets are resolved inside the main process only; the bus carries SecretRef ids.
 */
export function createIntegrationsWiring(input: {
  bus: CommandBusHost;
  repo: IntegrationsRepository;
  secrets: SecretService;
  projects: ProjectCatalog;
  projectSettings: ProjectSettingsService;
  logger: Logger;
  now?: (() => number) | undefined;
  newId?: ((prefix: string) => string) | undefined;
  executorFactory?: SqlExecutorFactory | undefined;
}): IntegrationsWiring {
  const now = input.now ?? Date.now;
  const newId =
    input.newId ??
    ((prefix: string) => `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
  const gateways = new Map<string, { updatedAt: number; db: ProjectDatabase }>();

  const gatewayFor = async (integration: Integration): Promise<ProjectDatabase> => {
    const cached = gateways.get(integration.id);
    if (cached?.updatedAt === integration.updatedAt) return cached.db;
    if (cached) await cached.db.close();
    const secret = integration.secretId
      ? await input.secrets.resolve({ id: integration.secretId })
      : undefined;
    const db = new ProjectDatabase({
      integration,
      adapter: databaseAdapter(integration.adapterId),
      secret,
      executorFactory: input.executorFactory,
      logger: input.logger.child(`db:${integration.id}`),
      now,
    });
    gateways.set(integration.id, { updatedAt: integration.updatedAt, db });
    return db;
  };

  const attached = (projectId: string): Integration | undefined => {
    const id = input.projectSettings.get(projectId).databaseIntegrationId;
    if (!id) return undefined;
    const integration = input.repo.get(id);
    return integration?.projectId === projectId ? integration : undefined;
  };

  const changed = (projectId: string) => {
    input.bus.publish(contracts.integrationsChanged, { projectId });
    input.bus.publish(workspace.cacheInvalidate, { scopes: ["integrations", "projectSettings", "dbSchema"] });
  };

  const wiring: IntegrationsWiring = {
    tools: createDatabaseTools({ databaseFor: (projectId) => wiring.databaseFor(projectId) }),
    async databaseUrlFor(projectId) {
      const integration = attached(projectId);
      if (!integration) return undefined;
      const db = await gatewayFor(integration);
      return db.target.connectionString;
    },
    async databaseFor(projectId) {
      const integration = attached(projectId);
      return integration ? gatewayFor(integration) : undefined;
    },
    async close() {
      await Promise.all([...gateways.values()].map((g) => g.db.close().catch(() => undefined)));
      gateways.clear();
    },
  };

  // ---- handlers
  input.bus.handle(contracts.integrationsAdapters, () =>
    DATABASE_ADAPTERS.map((a) => ({
      id: a.id,
      displayName: a.displayName,
      secret: a.secret,
      configFields: a.configFields.map((f) => ({
        key: f.key,
        label: f.label,
        required: f.required,
        ...(f.placeholder !== undefined ? { placeholder: f.placeholder } : {}),
      })),
      discoverable: a.discover !== undefined,
    })),
  );
  input.bus.handle(contracts.integrationsList, ({ projectId }) => {
    input.projects.get(projectId);
    return input.repo.list(projectId);
  });
  input.bus.handle(contracts.integrationsUpsert, async (req) => {
    const project = input.projects.get(req.projectId);
    const existing = req.id ? input.repo.get(req.id) : undefined;
    if (req.id && existing?.projectId !== project.id) {
      throw new AppError("not_found", "integrations.not_found", "Integration not found.", {
        details: { id: req.id },
      });
    }
    const adapter = databaseAdapter(req.adapterId);
    const secretId = req.secretId ?? existing?.secretId;
    const secretValue = secretId ? await input.secrets.resolve({ id: secretId }) : undefined;
    if (req.secretId !== undefined && secretValue === undefined) {
      throw new AppError("not_found", "integrations.secret_missing", "The referenced secret does not exist.");
    }
    // A replaced secret is no longer referenced by anything; remove it so it cannot linger.
    if (existing?.secretId && req.secretId && existing.secretId !== req.secretId) {
      await input.secrets.delete(existing.secretId).catch(() => undefined);
    }
    const integration: Integration = {
      id: existing?.id ?? newId("int"),
      projectId: project.id,
      kind: "database",
      adapterId: req.adapterId,
      name: req.name,
      config: req.config,
      status: "unconfigured",
      updatedAt: now(),
    };
    if (secretId) integration.secretId = secretId;
    // Validate config + secret shape now (throws AppError with guidance) without opening a connection.
    if (secretValue !== undefined) adapter.connectionFor(integration.config, secretValue);
    input.repo.upsert(integration);
    if (req.attach) input.projectSettings.update(project.id, { databaseIntegrationId: integration.id });
    changed(project.id);
    return integration;
  });
  input.bus.handle(contracts.integrationsDelete, async ({ id }) => {
    const integration = input.repo.get(id);
    if (!integration) return;
    const cached = gateways.get(id);
    if (cached) {
      gateways.delete(id);
      await cached.db.close().catch(() => undefined);
    }
    if (integration.secretId) await input.secrets.delete(integration.secretId).catch(() => undefined);
    input.repo.delete(id);
    if (input.projectSettings.get(integration.projectId).databaseIntegrationId === id) {
      input.projectSettings.unset(integration.projectId, "databaseIntegrationId");
    }
    changed(integration.projectId);
  });
  input.bus.handle(contracts.integrationsTest, async ({ id }) => {
    const integration = input.repo.get(id);
    if (!integration) throw new AppError("not_found", "integrations.not_found", "Integration not found.");
    try {
      const db = await gatewayFor(integration);
      const result = await db.test();
      input.repo.setStatus(id, result.ok ? "ready" : "error", result.ok ? undefined : result.message, now());
      changed(integration.projectId);
      return result.ok
        ? { ok: true, message: `Connected to ${result.serverVersion}.`, serverVersion: result.serverVersion }
        : { ok: false, message: result.message };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      input.repo.setStatus(id, "error", message, now());
      changed(integration.projectId);
      return { ok: false, message };
    }
  });
  input.bus.handle(contracts.integrationsDiscover, async ({ adapterId, secretId }, ctx) => {
    const adapter = databaseAdapter(adapterId);
    if (!adapter.discover)
      throw new AppError(
        "validation",
        "integrations.not_discoverable",
        `${adapter.displayName} has no discovery API.`,
      );
    const token = await input.secrets.resolve({ id: secretId });
    if (token === undefined)
      throw new AppError(
        "not_found",
        "integrations.secret_missing",
        "The access token secret does not exist.",
      );
    const instances = await adapter.discover(token, ctx.signal);
    return instances.map((i) => ({
      id: i.id,
      name: i.name,
      ...(i.region !== undefined ? { region: i.region } : {}),
      config: i.config,
      ...(i.branches
        ? { branches: i.branches.map((b) => ({ id: b.id, name: b.name, config: b.config })) }
        : {}),
    }));
  });
  input.bus.handle(contracts.dbIntrospect, async ({ projectId }) => {
    const db = await wiring.databaseFor(projectId);
    if (!db)
      throw new AppError("precondition", "db.not_configured", "No database is attached to this project.");
    const snapshot = await db.introspect();
    return {
      tables: snapshot.tables.map((t) => ({
        schema: t.schema,
        name: t.name,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
          primaryKey: c.primaryKey,
          ...(c.default !== undefined ? { default: c.default } : {}),
        })),
        foreignKeys: [...t.foreignKeys],
        indexes: [...t.indexes],
        estimatedRows: t.estimatedRows,
      })),
      capturedAt: snapshot.capturedAt,
      ...(snapshot.serverVersion !== undefined ? { serverVersion: snapshot.serverVersion } : {}),
    };
  });

  return wiring;
}
