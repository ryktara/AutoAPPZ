import { z } from "zod";
import { defineCommand, defineEvent, defineQuery } from "../definitions.ts";
import { ProjectIdSchema } from "../common.ts";

export const DatabaseAdapterIdSchema = z.enum(["postgres", "supabase", "neon"]);
export type DatabaseAdapterId = z.infer<typeof DatabaseAdapterIdSchema>;

export const IntegrationStatusSchema = z.enum(["unconfigured", "ready", "error"]);

/** A configured external service for a project. `config` is secret-free; the secret lives in the secrets service. */
export const IntegrationSchema = z.object({
  id: z.string().min(1),
  projectId: ProjectIdSchema,
  kind: z.enum(["database"]),
  adapterId: DatabaseAdapterIdSchema,
  name: z.string().min(1).max(80),
  config: z.record(z.string(), z.string()),
  secretId: z.string().min(1).optional(),
  status: IntegrationStatusSchema,
  statusMessage: z.string().max(1000).optional(),
  updatedAt: z.number().int().nonnegative(),
});
export type Integration = z.infer<typeof IntegrationSchema>;

export const AdapterDescriptorSchema = z.object({
  id: DatabaseAdapterIdSchema,
  displayName: z.string(),
  secret: z.object({
    kind: z.enum(["password", "connection-string", "api-key"]),
    label: z.string(),
    hint: z.string(),
  }),
  configFields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      required: z.boolean(),
      placeholder: z.string().optional(),
    }),
  ),
  discoverable: z.boolean(),
});

export const integrationsAdapters = defineQuery({
  name: "integrations.adapters",
  input: z.void(),
  output: z.array(AdapterDescriptorSchema),
  scope: "integrations",
});

export const integrationsList = defineQuery({
  name: "integrations.list",
  input: z.object({ projectId: ProjectIdSchema }),
  output: z.array(IntegrationSchema),
  scope: "integrations",
});

export const integrationsUpsert = defineCommand({
  name: "integrations.upsert",
  input: z.object({
    projectId: ProjectIdSchema,
    id: z.string().min(1).optional(),
    adapterId: DatabaseAdapterIdSchema,
    name: z.string().trim().min(1).max(80),
    config: z.record(z.string(), z.string().max(500)),
    /** Secret stored through `secrets.set` (password or connection string); omit to keep the current one. */
    secretId: z.string().min(1).optional(),
    /** Attach as the project's active database. */
    attach: z.boolean().default(true),
  }),
  output: IntegrationSchema,
  invalidates: ["integrations", "projectSettings", "secrets"],
});

export const integrationsDelete = defineCommand({
  name: "integrations.delete",
  input: z.object({ id: z.string().min(1) }),
  output: z.void(),
  invalidates: ["integrations", "projectSettings", "secrets"],
});

/** Connects and runs `SELECT version()`; updates the stored status. */
export const integrationsTest = defineCommand({
  name: "integrations.test",
  input: z.object({ id: z.string().min(1) }),
  output: z.object({ ok: z.boolean(), message: z.string(), serverVersion: z.string().optional() }),
  invalidates: ["integrations"],
});

/** Lists projects/branches reachable with a management API token stored via `secrets.set` (Supabase, Neon). */
export const integrationsDiscover = defineCommand({
  name: "integrations.discover",
  input: z.object({ adapterId: DatabaseAdapterIdSchema, secretId: z.string().min(1) }),
  output: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      region: z.string().optional(),
      config: z.record(z.string(), z.string()),
      branches: z
        .array(z.object({ id: z.string(), name: z.string(), config: z.record(z.string(), z.string()) }))
        .optional(),
    }),
  ),
  invalidates: [],
});

export const ColumnInfoSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  default: z.string().optional(),
  primaryKey: z.boolean(),
});
export const TableInfoSchema = z.object({
  schema: z.string(),
  name: z.string(),
  columns: z.array(ColumnInfoSchema),
  foreignKeys: z.array(
    z.object({ column: z.string(), referencesTable: z.string(), referencesColumn: z.string() }),
  ),
  indexes: z.array(z.object({ name: z.string(), definition: z.string() })),
  estimatedRows: z.number(),
});
export const SchemaSnapshotSchema = z.object({
  tables: z.array(TableInfoSchema),
  capturedAt: z.number().int().nonnegative(),
  serverVersion: z.string().optional(),
});
export type SchemaSnapshot = z.infer<typeof SchemaSnapshotSchema>;

export const dbIntrospect = defineQuery({
  name: "db.introspect",
  input: z.object({ projectId: ProjectIdSchema }),
  output: SchemaSnapshotSchema,
  scope: "dbSchema",
});

export const integrationsChanged = defineEvent({
  name: "integrations.changed",
  payload: z.object({ projectId: ProjectIdSchema }),
});
