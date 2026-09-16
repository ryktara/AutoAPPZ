import { z } from "zod";
import { defineCommand, defineEvent, defineQuery } from "../definitions.ts";

export const PluginCapabilitySchema = z.enum([
  "tools.register",
  "validators.register",
  "templates.register",
  "providers.model",
  "providers.deploy",
  "providers.database",
  "ui.panel",
]);
export type PluginCapability = z.infer<typeof PluginCapabilitySchema>;

export const PluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case id"),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  displayName: z.string().min(1).max(80),
  description: z.string().max(500).default(""),
  entry: z.string().min(1),
  capabilities: z.array(PluginCapabilitySchema).min(1),
  minHostVersion: z.string().regex(/^\d+\.\d+\.\d+/),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export const PluginRecordSchema = z.object({
  id: z.string().min(1),
  /** Folder the plugin was installed from (read at activation; never copied elsewhere). */
  dir: z.string().min(1),
  manifest: PluginManifestSchema,
  enabled: z.boolean(),
  /** Capabilities the user granted; never more than the manifest declares. */
  granted: z.array(PluginCapabilitySchema),
  status: z.enum(["inactive", "active", "error"]),
  error: z.string().optional(),
  /** Tools the plugin registered while active. */
  tools: z.array(z.string()).default([]),
  installedAt: z.number().int().nonnegative(),
});
export type PluginRecord = z.infer<typeof PluginRecordSchema>;

export const pluginsList = defineQuery({
  name: "plugins.list",
  input: z.void(),
  output: z.array(PluginRecordSchema),
  scope: "plugins",
});

/** Validates the folder's manifest and entry (forbidden imports) and records it disabled; nothing runs yet. */
export const pluginsInstall = defineCommand({
  name: "plugins.install",
  input: z.object({ dir: z.string().min(1) }),
  output: PluginRecordSchema,
  invalidates: ["plugins"],
});

export const pluginsSetEnabled = defineCommand({
  name: "plugins.setEnabled",
  input: z.object({ id: z.string().min(1), enabled: z.boolean() }),
  output: PluginRecordSchema,
  invalidates: ["plugins"],
});

export const pluginsGrant = defineCommand({
  name: "plugins.grant",
  input: z.object({ id: z.string().min(1), capabilities: z.array(PluginCapabilitySchema) }),
  output: PluginRecordSchema,
  invalidates: ["plugins"],
});

export const pluginsRemove = defineCommand({
  name: "plugins.remove",
  input: z.object({ id: z.string().min(1) }),
  output: z.void(),
  invalidates: ["plugins"],
});

export const pluginsChanged = defineEvent({
  name: "plugins.changed",
  payload: z.object({ id: z.string().min(1) }),
});
