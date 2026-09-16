import path from "node:path";
import { z } from "zod";
import type { CommandBusHost } from "@autoappz/command-bus";
import { AppError, plugins as contracts, workspace } from "@autoappz/contracts";
import type { Logger } from "@autoappz/diagnostics";
import {
  activatePlugin,
  forbiddenImports,
  loadPluginManifest,
  type ActivatedPlugin,
} from "@autoappz/plugins";
import type { SettingsRepository } from "@autoappz/storage";
import type { ToolRuntime } from "@autoappz/tools";

type PluginRecord = contracts.PluginRecord;

const SETTINGS_KEY = "plugins.installed";
const StoredSchema = z.array(contracts.PluginRecordSchema.omit({ status: true, error: true, tools: true }));
type Stored = z.infer<typeof StoredSchema>[number];

export interface PluginsWiring {
  close(): Promise<void>;
}

/**
 * In-process plugins (ADR-010): installed from a folder the user picked, disabled until enabled, granted
 * capabilities never exceed the manifest, tools registered through the tool runtime.
 */
export function createPluginsWiring(input: {
  bus: CommandBusHost;
  settings: SettingsRepository;
  tools: ToolRuntime;
  logger: Logger;
  appVersion: string;
  now?: (() => number) | undefined;
}): PluginsWiring {
  const now = input.now ?? Date.now;
  const active = new Map<string, ActivatedPlugin>();
  const errors = new Map<string, string>();

  // The settings repository defaults missing keys to {}; this key holds an array, so parse the raw value.
  const stored = (): Stored[] => {
    const parsed = StoredSchema.safeParse(input.settings.getRaw(SETTINGS_KEY) ?? []);
    return parsed.success ? parsed.data : [];
  };
  const save = (list: Stored[]) => {
    input.settings.set(SETTINGS_KEY, list);
  };
  const changed = (id: string) => {
    input.bus.publish(contracts.pluginsChanged, { id });
    input.bus.publish(workspace.cacheInvalidate, { scopes: ["plugins"] });
  };
  const view = (s: Stored): PluginRecord => {
    const running = active.get(s.id);
    const error = errors.get(s.id);
    return {
      ...s,
      status: running ? "active" : error ? "error" : "inactive",
      ...(error !== undefined ? { error } : {}),
      tools: running ? [...running.tools] : [],
    };
  };
  const find = (id: string): Stored => {
    const s = stored().find((p) => p.id === id);
    if (!s) throw new AppError("not_found", "plugins.not_found", "Plugin not found.", { details: { id } });
    return s;
  };

  const activate = async (s: Stored): Promise<void> => {
    await deactivate(s.id);
    try {
      const source = loadPluginManifest(s.dir);
      if (source.manifest.id !== s.id)
        throw new AppError(
          "validation",
          "plugins.id_changed",
          "The plugin folder's id no longer matches the installed record.",
        );
      const plugin = await activatePlugin(source, s.granted, {
        hostVersion: input.appVersion,
        log: input.logger.child(`plugin:${s.id}`),
        registerTool: (tool) => {
          input.tools.unregister(tool.id);
          input.tools.register(tool);
        },
        unregisterTool: (id) => {
          input.tools.unregister(id);
        },
      });
      active.set(s.id, plugin);
      errors.delete(s.id);
      input.logger.info("plugin activated", { id: s.id, tools: plugin.tools.length });
    } catch (error) {
      errors.set(s.id, error instanceof Error ? error.message : String(error));
      input.logger.warn("plugin failed to activate", { id: s.id, message: errors.get(s.id) });
    }
  };
  const deactivate = async (id: string): Promise<void> => {
    const plugin = active.get(id);
    if (!plugin) return;
    active.delete(id);
    await plugin.deactivate().catch(() => undefined);
  };

  input.bus.handle(contracts.pluginsList, () => stored().map(view));
  input.bus.handle(contracts.pluginsInstall, ({ dir }) => {
    const source = loadPluginManifest(path.resolve(dir));
    const forbidden = forbiddenImports(source.entryPath);
    if (forbidden.length > 0)
      throw new AppError(
        "validation",
        "plugins.forbidden_import",
        `This plugin imports modules plugins may not use: ${forbidden.join(", ")}.`,
        { details: { forbidden } },
      );
    const list = stored().filter((p) => p.id !== source.manifest.id);
    const record: Stored = {
      id: source.manifest.id,
      dir: source.dir,
      manifest: source.manifest,
      enabled: false,
      granted: [],
      installedAt: now(),
    };
    save([...list, record]);
    changed(record.id);
    return view(record);
  });
  input.bus.handle(contracts.pluginsGrant, ({ id, capabilities }) => {
    const s = find(id);
    const granted = capabilities.filter((c) => s.manifest.capabilities.includes(c));
    const next: Stored = { ...s, granted };
    save(stored().map((p) => (p.id === id ? next : p)));
    changed(id);
    return view(next);
  });
  input.bus.handle(contracts.pluginsSetEnabled, async ({ id, enabled }) => {
    const s = find(id);
    const next: Stored = { ...s, enabled };
    save(stored().map((p) => (p.id === id ? next : p)));
    if (enabled) await activate(next);
    else {
      await deactivate(id);
      errors.delete(id);
    }
    changed(id);
    return view(next);
  });
  input.bus.handle(contracts.pluginsRemove, async ({ id }) => {
    await deactivate(id);
    errors.delete(id);
    save(stored().filter((p) => p.id !== id));
    changed(id);
  });

  // Enabled plugins activate at startup; failures are recorded per plugin.
  void (async () => {
    for (const s of stored()) if (s.enabled) await activate(s);
  })();

  return {
    async close() {
      for (const id of [...active.keys()]) await deactivate(id);
    },
  };
}
