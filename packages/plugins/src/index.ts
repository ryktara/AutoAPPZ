import { z } from "zod";

export const PLUGIN_CAPABILITIES = [
  "tools.register",
  "validators.register",
  "templates.register",
  "providers.model",
  "providers.deploy",
  "providers.database",
  "ui.panel",
] as const;

export const PluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case id"),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  displayName: z.string().min(1).max(80),
  description: z.string().max(500).default(""),
  entry: z.string().min(1),
  capabilities: z.array(z.enum(PLUGIN_CAPABILITIES)).min(1),
  minHostVersion: z.string().regex(/^\d+\.\d+\.\d+/),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export interface PluginHost {
  readonly hostVersion: string;
  /** Capabilities actually granted (may be a subset of the manifest). */
  readonly granted: ReadonlySet<PluginManifest["capabilities"][number]>;
}
