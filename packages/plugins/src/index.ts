import { plugins as contracts } from "@autoappz/contracts";
import type { AnyTool } from "@autoappz/tools";

export const PLUGIN_CAPABILITIES = contracts.PluginCapabilitySchema.options;
export const PluginManifestSchema = contracts.PluginManifestSchema;
export type PluginManifest = contracts.PluginManifest;
export type PluginCapability = contracts.PluginCapability;

/** SDK version plugins compile against; bumped on breaking changes to `PluginContext`. */
export const PLUGIN_SDK_VERSION = "1.0.0";

export interface PluginLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
}

/** Tool contributed by a plugin: same contract as built-in tools, validated by the host. */
export type PluginTool = AnyTool;

/**
 * What a plugin can reach. Every namespace is gated by a capability; calling an ungranted one
 * throws before anything happens. No Electron, filesystem or process access is ever exposed.
 */
export interface PluginContext {
  readonly host: { readonly version: string; readonly sdkVersion: string; readonly pluginId: string };
  readonly granted: ReadonlySet<PluginCapability>;
  readonly log: PluginLogger;
  /** requires `tools.register` */
  readonly tools: { register(tool: PluginTool): void };
  /** requires `validators.register` */
  readonly validators: {
    register(validator: {
      id: string;
      run(input: {
        projectRoot: string;
        changedPaths: readonly string[];
      }): Promise<{ ok: boolean; message?: string }>;
    }): void;
  };
  /** requires `templates.register` */
  readonly templates: {
    register(template: { id: string; displayName: string; description: string; dir: string }): void;
  };
  /** requires `ui.panel` */
  readonly ui: { registerPanel(panel: { id: string; title: string; render(): string }): void };
}

export interface PluginModule {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export {
  activatePlugin,
  forbiddenImports,
  loadPluginManifest,
  PluginLoadError,
  satisfiesMinHost,
} from "./loader.ts";
export type { ActivatedPlugin, HostBindings, PluginSource } from "./loader.ts";
