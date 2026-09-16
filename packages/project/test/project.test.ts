import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AppError } from "@autoappz/contracts";
import {
  BlueprintsRepository,
  ProjectMemoryRepository,
  ProjectsRepository,
  RequirementsRepository,
  SettingsRepository,
  openDatabase,
} from "@autoappz/storage";
import { withTempDir } from "@autoappz/testing";
import {
  BlueprintService,
  BundledTemplateSource,
  ProjectCatalog,
  ProjectMemoryService,
  ProjectSettingsService,
  RequirementsService,
  TemplateRegistry,
  assertAllowedProjectDirectory,
  slugify,
} from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(here, "../../../templates");

function setup(root: string) {
  const dataDirectory = path.join(root, "data");
  const homeDirectory = path.join(root, "home");
  const projectsDir = path.join(homeDirectory, "autoappz-projects");
  mkdirSync(dataDirectory, { recursive: true });
  mkdirSync(homeDirectory, { recursive: true });
  const h = openDatabase({ path: ":memory:" });
  let n = 0;
  const catalog = new ProjectCatalog({
    repo: new ProjectsRepository(h.db),
    templates: new TemplateRegistry([new BundledTemplateSource(TEMPLATES_DIR)]),
    policy: { dataDirectory, homeDirectory },
    defaultParentDirectory: () => projectsDir,
    now: () => 1000 + n,
    newId: () => `prj_${String(++n).padStart(3, "0")}`,
  });
  return { h, catalog, dataDirectory, homeDirectory, projectsDir };
}

describe("path policy", () => {
  it("rejects roots, home, data dir and relative paths", () => {
    const policy = { dataDirectory: "/tmp/data", homeDirectory: "/home/me" };
    const root = path.parse(path.resolve("/")).root;
    expect(() => assertAllowedProjectDirectory(root, policy)).toThrow(AppError);
    expect(() => assertAllowedProjectDirectory("/home/me", policy)).toThrow(/home directory/);
    expect(() => assertAllowedProjectDirectory("/tmp/data/x", policy)).toThrow(/data directory/);
    expect(() => assertAllowedProjectDirectory("relative/path", policy)).toThrow(/absolute/);
    expect(assertAllowedProjectDirectory("/home/me/projects/a", policy)).toBe(
      path.resolve("/home/me/projects/a"),
    );
  });

  it("slugifies names", () => {
    expect(slugify("My Café App!")).toBe("my-cafe-app");
    expect(slugify("///")).toBe("project");
  });
});

describe("templates", () => {
  it("lists the bundled react-vite template with argument-array commands", () => {
    const source = new BundledTemplateSource(TEMPLATES_DIR);
    const templates = source.list();
    const rv = templates.find((t) => t.id === "react-vite");
    expect(rv).toBeDefined();
    expect(rv!.runtime.install[0]).toBe("pnpm");
    expect(rv!.runtime.dev.every((a) => !a.includes(" "))).toBe(true);
  });

  it("materialized projects are portable: no @autoappz dependencies, no template manifest", async () => {
    await withTempDir(async (root) => {
      const { catalog } = setup(root);
      const p = catalog.create({ name: "Portable App", templateId: "react-vite" });
      const pkg = JSON.parse(readFileSync(path.join(p.path, "package.json"), "utf8")) as Record<
        string,
        unknown
      >;
      expect(pkg["name"]).toBe("portable-app");
      const allDeps = JSON.stringify([pkg["dependencies"], pkg["devDependencies"]]);
      expect(allDeps).not.toContain("@autoappz");
      expect(existsSync(path.join(p.path, "template.json"))).toBe(false);
      expect(existsSync(path.join(p.path, "src", "main.tsx"))).toBe(true);
      expect(existsSync(path.join(p.path, "node_modules"))).toBe(false);
      await Promise.resolve();
    });
  });
});

describe("ProjectCatalog", () => {
  it("creates, lists, opens, renames and removes projects", async () => {
    await withTempDir(async (root) => {
      const { catalog, projectsDir } = setup(root);
      const a = catalog.create({ name: "Alpha", templateId: "react-vite" });
      expect(a.path).toBe(path.join(projectsDir, "alpha"));
      expect(a.origin).toBe("created");
      const b = catalog.create({ name: "Alpha", templateId: "react-vite" });
      expect(b.path).toBe(path.join(projectsDir, "alpha-2"));

      expect(catalog.list().map((p) => p.id)).toEqual([b.id, a.id]);
      const opened = catalog.open(a.id);
      expect(opened.lastOpenedAt).toBeGreaterThan(a.lastOpenedAt);
      expect(catalog.list()[0]!.id).toBe(a.id);
      expect(catalog.rename(a.id, "Alpha Prime").name).toBe("Alpha Prime");
      expect(() => catalog.rename(a.id, "bad/name")).toThrow();

      catalog.delete({ id: b.id, deleteFiles: false });
      expect(existsSync(b.path)).toBe(true);
      expect(() => catalog.get(b.id)).toThrow(/not found/);
      await Promise.resolve();
    });
  });

  it("stores canonical project paths when a directory is reached through a link", async () => {
    await withTempDir(async (root) => {
      const { catalog, homeDirectory } = setup(root);
      const real = path.join(homeDirectory, "real-parent");
      mkdirSync(real, { recursive: true });
      const link = path.join(homeDirectory, "linked-parent");
      try {
        symlinkSync(real, link, "junction");
      } catch {
        return; // symlink creation not permitted in this environment
      }
      const created = catalog.create({ name: "Via Link", templateId: "react-vite", parentDirectory: link });
      expect(created.path).toBe(path.join(realpathSync.native(real), "via-link"));
      // An existing folder reached through the link is registered under its canonical path as well.
      mkdirSync(path.join(real, "existing"), { recursive: true });
      writeFileSync(path.join(real, "existing", "package.json"), "{}\n");
      const imported = catalog.import({ sourcePath: path.join(link, "existing"), mode: "in_place" });
      expect(imported.path).toBe(path.join(realpathSync.native(real), "existing"));
      await Promise.resolve();
    });
  });

  it("refuses unknown templates and leaves no directory behind", async () => {
    await withTempDir(async (root) => {
      const { catalog, projectsDir } = setup(root);
      expect(() => catalog.create({ name: "Nope", templateId: "does-not-exist" })).toThrow(
        /Unknown template/,
      );
      expect(existsSync(path.join(projectsDir, "nope"))).toBe(false);
      await Promise.resolve();
    });
  });

  it("imports in place without copying or executing, and refuses duplicates", async () => {
    await withTempDir(async (root) => {
      const { catalog, homeDirectory } = setup(root);
      const src = path.join(homeDirectory, "existing-app");
      mkdirSync(path.join(src, "node_modules"), { recursive: true });
      writeFileSync(
        path.join(src, "package.json"),
        JSON.stringify({ name: "x", scripts: { postinstall: "exit 1" } }),
      );
      const p = catalog.import({ sourcePath: src, mode: "in_place" });
      expect(p.origin).toBe("imported");
      expect(p.path).toBe(src);
      expect(p.name).toBe("existing-app");
      expect(() => catalog.import({ sourcePath: src, mode: "in_place" })).toThrow(/already a project/);
      expect(() =>
        catalog.import({ sourcePath: path.join(homeDirectory, "missing"), mode: "in_place" }),
      ).toThrow(/does not exist/);
      await Promise.resolve();
    });
  });

  it("imports by copy, skipping node_modules", async () => {
    await withTempDir(async (root) => {
      const { catalog, homeDirectory, projectsDir } = setup(root);
      const src = path.join(homeDirectory, "existing-app");
      mkdirSync(path.join(src, "node_modules", "dep"), { recursive: true });
      mkdirSync(path.join(src, "src"), { recursive: true });
      writeFileSync(path.join(src, "src", "a.ts"), "export {}");
      const p = catalog.import({ sourcePath: src, mode: "copy", name: "Copied" });
      expect(p.origin).toBe("copied");
      expect(p.path).toBe(path.join(projectsDir, "copied"));
      expect(readdirSync(p.path).sort()).toEqual(["src"]);
      await Promise.resolve();
    });
  });

  it("deletes files only for managed projects with a typed confirmation", async () => {
    await withTempDir(async (root) => {
      const { catalog, homeDirectory } = setup(root);
      const src = path.join(homeDirectory, "mine");
      mkdirSync(src, { recursive: true });
      const imported = catalog.import({ sourcePath: src, mode: "in_place" });
      expect(() => catalog.delete({ id: imported.id, deleteFiles: true, confirmName: "mine" })).toThrow(
        /imported in place/,
      );
      expect(existsSync(src)).toBe(true);

      const created = catalog.create({ name: "Managed", templateId: "react-vite" });
      expect(() => catalog.delete({ id: created.id, deleteFiles: true, confirmName: "wrong" })).toThrow(
        /Type the project name/,
      );
      expect(existsSync(created.path)).toBe(true);
      catalog.delete({ id: created.id, deleteFiles: true, confirmName: "Managed" });
      expect(existsSync(created.path)).toBe(false);
      await Promise.resolve();
    });
  });

  it("never imports child_process (import/create execute nothing)", () => {
    const srcDir = path.resolve(here, "../src");
    for (const file of readdirSync(srcDir)) {
      const text = readFileSync(path.join(srcDir, file), "utf8");
      expect(text, file).not.toMatch(/child_process|execSync|spawn\(/);
    }
  });
});

describe("blueprint, requirements, memory, project settings", () => {
  it("versions blueprints, approves only the latest, derives requirements preserving statuses", () => {
    const h = openDatabase({ path: ":memory:" });
    new ProjectsRepository(h.db).insert({
      id: "p1",
      name: "P",
      path: "/x/p",
      origin: "created",
      runtimeProfile: "host",
      createdAt: 1,
      lastOpenedAt: 1,
    });
    let n = 0;
    const bps = new BlueprintService(
      new BlueprintsRepository(h.db),
      () => 500,
      () => `bp_${String(++n)}`,
    );
    const reqs = new RequirementsService(new RequirementsRepository(h.db), new BlueprintsRepository(h.db));
    expect(bps.latest("p1")).toBeNull();

    const v1 = bps.save("p1", {
      product: { name: "Shop" },
      pages: [{ id: "home", title: "Home", path: "/" }],
      entities: [{ name: "Product" }],
      acceptance_criteria: [
        { id: "ac1", text: "Home lists products", ref: "home" },
        { id: "ac2", text: "Site loads under 2s" },
      ],
    } as never);
    expect(v1.version).toBe(1);
    const first = reqs.sync("p1");
    expect(first.requirements.map((r) => [r.id, r.blueprintItemRef])).toEqual([
      ["REQ-001", "page:home"],
      ["REQ-002", "entity:Product"],
      ["REQ-003", "general"],
    ]);
    expect(first.criteria.map((c) => [c.id, c.requirementId])).toEqual([
      ["AC-001", "REQ-001"],
      ["AC-002", "REQ-003"],
    ]);

    // mark one met, then add a page and re-sync: status survives, numbering is stable-by-order
    new RequirementsRepository(h.db).replace(
      "p1",
      first.requirements.map((r) => (r.id === "REQ-002" ? { ...r, status: "met" as const } : r)),
      first.criteria,
    );
    const v2 = bps.save("p1", {
      ...v1.document,
      pages: [...v1.document.pages, { id: "cart", title: "Cart", path: "/cart", purpose: "", roles: [] }],
    });
    expect(v2.version).toBe(2);
    const second = reqs.sync("p1");
    expect(second.requirements.find((r) => r.blueprintItemRef === "entity:Product")?.status).toBe("met");
    expect(second.requirements).toHaveLength(4);

    expect(() => bps.approve("p1", 1)).toThrow(/latest/);
    expect(bps.approve("p1", 2).approvedAt).toBe(500);
    expect(bps.latest("p1")?.approvedAt).toBe(500);

    const mem = new ProjectMemoryService(
      new ProjectMemoryRepository(h.db),
      () => 7,
      () => `mem_${String(++n)}`,
    );
    const m1 = mem.add({ projectId: "p1", category: "conventions", statement: "Use pnpm" });
    const m2 = mem.supersede(m1.id, "Use pnpm 11");
    expect(mem.list("p1").map((i) => i.statement)).toEqual(["Use pnpm 11"]);
    expect(mem.list("p1", true)).toHaveLength(2);
    expect(mem.list("p1", true)[0]?.supersededBy).toBe(m2.id);
    expect(() => mem.supersede(m1.id, "again")).toThrow(/already replaced/);
    mem.delete(m2.id);
    expect(() => mem.delete(m2.id)).toThrow(/not found/);

    const ps = new ProjectSettingsService(new SettingsRepository(h.db));
    expect(ps.get("p1").runtimeProfile).toBe("host");
    expect(ps.update("p1", { runtimeProfile: "container" }).runtimeProfile).toBe("container");
    expect(ps.get("p1").contextBudgetTokens).toBe(60_000);
    h.close();
  });
});
