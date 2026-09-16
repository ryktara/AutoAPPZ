import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AppError } from "@autoappz/contracts";
import type { AnyTool } from "@autoappz/tools";
import type { PluginCapability, PluginContext, PluginLogger, PluginManifest, PluginModule } from "./index.ts";
import { PLUGIN_SDK_VERSION, PluginManifestSchema } from "./index.ts";

export class PluginLoadError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super("validation", code, message, { details });
  }
}

export interface PluginSource {
  readonly dir: string;
  readonly manifest: PluginManifest;
  readonly entryPath: string;
}

/** Modules an in-process plugin must never import (ADR-010): host, filesystem, processes, networking. */
const FORBIDDEN_MODULES = [
  "electron",
  "fs",
  "fs/promises",
  "child_process",
  "worker_threads",
  "cluster",
  "net",
  "tls",
  "dgram",
  "http",
  "https",
  "http2",
  "vm",
  "v8",
  "os",
  "process",
  "module",
  "inspector",
  "repl",
];

/** Reads and validates `plugin.json`, checks the entry exists and is a plain `.js`/`.mjs` file. */
export function loadPluginManifest(dir: string): PluginSource {
  const file = path.join(dir, "plugin.json");
  if (!existsSync(file))
    throw new PluginLoadError("plugins.no_manifest", "The folder has no plugin.json.", { dir });
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new PluginLoadError(
      "plugins.invalid_manifest",
      `plugin.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PluginLoadError("plugins.invalid_manifest", "plugin.json does not match the manifest schema.", {
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }
  const manifest = parsed.data;
  if (manifest.entry.includes("..") || path.isAbsolute(manifest.entry))
    throw new PluginLoadError(
      "plugins.invalid_entry",
      "The entry must be a relative path inside the plugin folder.",
    );
  const entryPath = path.join(dir, manifest.entry);
  if (!existsSync(entryPath) || !statSync(entryPath).isFile())
    throw new PluginLoadError("plugins.invalid_entry", `Entry "${manifest.entry}" does not exist.`);
  if (!/\.(m?js)$/.test(entryPath))
    throw new PluginLoadError(
      "plugins.invalid_entry",
      "The entry must be a JavaScript module (.js or .mjs).",
    );
  return { dir, manifest, entryPath };
}

/**
 * Static scan of the entry (and relative modules it imports) for forbidden imports/requires. It is a
 * guard rail for honest plugins, not a sandbox: in-process plugins are trusted code the user installed.
 */
export function forbiddenImports(entryPath: string): string[] {
  const seen = new Set<string>();
  const found = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const specifiers = [
      ...source.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm),
    ].map((m) => m[1] ?? "");
    for (const spec of specifiers) {
      const bare = spec.replace(/^node:/, "");
      if (FORBIDDEN_MODULES.includes(bare) || bare.startsWith("electron/")) found.add(spec);
      else if (spec.startsWith(".")) visit(path.resolve(path.dirname(file), spec));
    }
  };
  visit(entryPath);
  return [...found];
}

export function satisfiesMinHost(hostVersion: string, minHostVersion: string): boolean {
  const parse = (v: string) =>
    v
      .split(".")
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parse(hostVersion), parse(minHostVersion)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return true;
}

export interface HostBindings {
  readonly hostVersion: string;
  readonly log: PluginLogger;
  readonly registerTool: (tool: AnyTool) => void;
  readonly unregisterTool: (id: string) => void;
  readonly registerValidator?:
    ((validator: Parameters<PluginContext["validators"]["register"]>[0]) => void) | undefined;
  readonly registerTemplate?:
    ((template: Parameters<PluginContext["templates"]["register"]>[0]) => void) | undefined;
  readonly registerPanel?: ((panel: Parameters<PluginContext["ui"]["registerPanel"]>[0]) => void) | undefined;
}

export interface ActivatedPlugin {
  readonly manifest: PluginManifest;
  readonly tools: readonly string[];
  deactivate(): Promise<void>;
}

/**
 * Imports the entry and calls `activate` with a context that exposes only the granted capabilities.
 * Ungranted namespaces throw `plugins.capability_denied`; grants beyond the manifest are impossible.
 */
export async function activatePlugin(
  source: PluginSource,
  granted: readonly PluginCapability[],
  host: HostBindings,
): Promise<ActivatedPlugin> {
  const { manifest } = source;
  if (!satisfiesMinHost(host.hostVersion, manifest.minHostVersion)) {
    throw new PluginLoadError(
      "plugins.host_too_old",
      `${manifest.displayName} needs host ${manifest.minHostVersion} or newer.`,
    );
  }
  const forbidden = forbiddenImports(source.entryPath);
  if (forbidden.length > 0) {
    throw new PluginLoadError(
      "plugins.forbidden_import",
      `${manifest.displayName} imports modules plugins may not use: ${forbidden.join(", ")}.`,
      { forbidden },
    );
  }
  const effective = new Set<PluginCapability>(granted.filter((c) => manifest.capabilities.includes(c)));
  const registeredTools: string[] = [];
  const require = (capability: PluginCapability) => {
    if (!effective.has(capability))
      throw new AppError(
        "permission",
        "plugins.capability_denied",
        `${manifest.displayName} tried to use "${capability}" without that capability being granted.`,
        { details: { pluginId: manifest.id, capability } },
      );
  };
  const ctx: PluginContext = {
    host: { version: host.hostVersion, sdkVersion: PLUGIN_SDK_VERSION, pluginId: manifest.id },
    granted: effective,
    log: host.log,
    tools: {
      register: (tool) => {
        require("tools.register");
        if (!tool.id.startsWith(`${manifest.id}.`))
          throw new AppError(
            "validation",
            "plugins.tool_namespace",
            `Plugin tools must be namespaced as "${manifest.id}.<name>" (got "${tool.id}").`,
          );
        host.registerTool(tool);
        registeredTools.push(tool.id);
      },
    },
    validators: {
      register: (validator) => {
        require("validators.register");
        host.registerValidator?.(validator);
      },
    },
    templates: {
      register: (template) => {
        require("templates.register");
        host.registerTemplate?.(template);
      },
    },
    ui: {
      registerPanel: (panel) => {
        require("ui.panel");
        host.registerPanel?.(panel);
      },
    },
  };
  Object.freeze(ctx);
  let mod: PluginModule;
  try {
    mod = (await import(`${pathToFileURL(source.entryPath).href}?t=${String(Date.now())}`)) as PluginModule;
  } catch (error) {
    throw new PluginLoadError(
      "plugins.load_failed",
      `Could not load ${manifest.displayName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof mod.activate !== "function")
    throw new PluginLoadError("plugins.no_activate", `${manifest.displayName} does not export activate().`);
  try {
    await mod.activate(ctx);
  } catch (error) {
    for (const id of registeredTools) host.unregisterTool(id);
    if (error instanceof AppError) throw error;
    throw new PluginLoadError(
      "plugins.activate_failed",
      `${manifest.displayName} failed to activate: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    manifest,
    tools: registeredTools,
    async deactivate() {
      for (const id of registeredTools) host.unregisterTool(id);
      await mod.deactivate?.();
    },
  };
}
