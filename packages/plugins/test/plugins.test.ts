import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PermissionEngine } from "@autoappz/permissions";
import { Redactor } from "@autoappz/diagnostics";
import { ReadLedger, ToolRuntime, type AnyTool } from "@autoappz/tools";
import {
  PluginManifestSchema,
  activatePlugin,
  forbiddenImports,
  loadPluginManifest,
  satisfiesMinHost,
  type HostBindings,
} from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(here, "../../../examples/plugins/word-count");
const FIXTURES = path.join(here, "fixtures");

function host(): HostBindings & { tools: Map<string, AnyTool>; logs: string[] } {
  const tools = new Map<string, AnyTool>();
  const logs: string[] = [];
  return {
    tools,
    logs,
    hostVersion: "1.2.3",
    log: {
      info: (m) => {
        logs.push(m);
      },
      warn: (m) => {
        logs.push(`warn:${m}`);
      },
    },
    registerTool: (t) => {
      tools.set(t.id, t);
    },
    unregisterTool: (id) => {
      tools.delete(id);
    },
  };
}

describe("manifest and version checks", () => {
  it("accepts a valid manifest and rejects bad ids/capabilities", () => {
    expect(
      PluginManifestSchema.safeParse({
        id: "my-plugin",
        version: "1.0.0",
        displayName: "X",
        entry: "index.js",
        capabilities: ["tools.register"],
        minHostVersion: "0.1.0",
      }).success,
    ).toBe(true);
    expect(
      PluginManifestSchema.safeParse({
        id: "My Plugin",
        version: "1",
        displayName: "X",
        entry: "i",
        capabilities: ["nope"],
        minHostVersion: "0.1.0",
      }).success,
    ).toBe(false);
    expect(satisfiesMinHost("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesMinHost("1.2.3", "1.3.0")).toBe(false);
    expect(satisfiesMinHost("2.0.0", "1.9.9")).toBe(true);
  });

  it("loads the sample manifest and rejects folders without one or with a bad entry", () => {
    const source = loadPluginManifest(SAMPLE);
    expect(source.manifest.id).toBe("word-count");
    expect(source.entryPath.endsWith("index.mjs")).toBe(true);
    expect(() => loadPluginManifest(here)).toThrow(/plugin.json/);
  });
});

describe("activation", () => {
  it("the sample plugin registers a namespaced tool that runs through the tool runtime", async () => {
    const h = host();
    const active = await activatePlugin(loadPluginManifest(SAMPLE), ["tools.register"], h);
    expect(active.tools).toEqual(["word-count.count"]);
    expect(h.logs).toContain("word-count activated");
    const runtime = new ToolRuntime({
      tools: [...h.tools.values()],
      permissions: new PermissionEngine({
        store: { list: () => [], insert: () => undefined, delete: () => false },
        consentTimeoutMs: 100,
      }),
      audit: { record: () => undefined },
      redactor: new Redactor(),
    });
    expect(runtime.specs().map((s) => s.name)).toEqual(["word-count.count"]);
    const result = await runtime.execute({
      toolId: "word-count.count",
      input: { text: "hello brave\nnew world" },
      projectId: "p",
      projectRoot: here,
      taskId: "t",
      signal: new AbortController().signal,
      ledger: new ReadLedger(),
    });
    expect(result.ok && result.value).toEqual({ words: 4, lines: 2, characters: 21 });
    await active.deactivate();
    expect(h.tools.size).toBe(0);
  });

  it("a plugin cannot use a capability that was not granted, even if its manifest declares it", async () => {
    const h = host();
    await expect(
      activatePlugin(loadPluginManifest(path.join(FIXTURES, "greedy")), ["tools.register"], h),
    ).rejects.toMatchObject({ code: "plugins.capability_denied" });
    expect(h.tools.size).toBe(0);
    // grants beyond the manifest are ignored: granting ui.panel to word-count does not add it
    const sample = await activatePlugin(loadPluginManifest(SAMPLE), ["tools.register", "ui.panel"], h);
    expect(sample.tools).toEqual(["word-count.count"]);
    await sample.deactivate();
  });

  it("refuses plugins that import host, filesystem, process or network modules (including transitively)", async () => {
    const rogue = loadPluginManifest(path.join(FIXTURES, "rogue"));
    expect(forbiddenImports(rogue.entryPath).sort()).toEqual(["child_process", "node:fs"]);
    await expect(activatePlugin(rogue, ["tools.register"], host())).rejects.toMatchObject({
      code: "plugins.forbidden_import",
    });
  });

  it("refuses when the host is older than minHostVersion", async () => {
    const source = {
      ...loadPluginManifest(SAMPLE),
      manifest: { ...loadPluginManifest(SAMPLE).manifest, minHostVersion: "9.0.0" },
    };
    await expect(activatePlugin(source, ["tools.register"], host())).rejects.toMatchObject({
      code: "plugins.host_too_old",
    });
  });
});
