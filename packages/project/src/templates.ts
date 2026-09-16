import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AppError, project as contracts } from "@autoappz/contracts";

type Template = contracts.Template;

/** `template.json` at the root of each bundled template directory. */
export const TemplateManifestSchema = contracts.TemplateSchema.extend({
  /** Paths (relative, forward slashes) never copied into a project. */
  exclude: z.array(z.string().min(1)).default([]),
});
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

export interface MaterializeOptions {
  readonly projectName: string;
}

export interface TemplateSource {
  readonly id: string;
  list(): Template[];
  materialize(templateId: string, targetDir: string, options: MaterializeOptions): void;
}

const ALWAYS_EXCLUDED = new Set(["node_modules", ".git", "dist", ".vite", "template.json"]);

/**
 * Templates shipped in the repository's `templates/` directory. Materializing is a pure file copy plus
 * a `package.json` name rewrite: it never installs dependencies or runs any process.
 */
export class BundledTemplateSource implements TemplateSource {
  readonly id = "bundled";

  constructor(private readonly rootDir: string) {}

  list(): Template[] {
    if (!existsSync(this.rootDir)) return [];
    const out: Template[] = [];
    for (const entry of readdirSync(this.rootDir)) {
      const manifest = this.manifestFor(entry);
      if (manifest) {
        out.push(stripManifestOnlyFields(manifest));
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  materialize(templateId: string, targetDir: string, options: MaterializeOptions): void {
    const manifest = this.manifestFor(templateId);
    if (manifest?.id !== templateId) {
      throw new AppError("not_found", "template.not_found", `Unknown template "${templateId}".`);
    }
    const source = path.join(this.rootDir, templateId);
    const excluded = new Set([...ALWAYS_EXCLUDED, ...manifest.exclude]);
    cpSync(source, targetDir, {
      recursive: true,
      errorOnExist: false,
      filter: (src) => {
        const rel = path.relative(source, src).split(path.sep).join("/");
        if (rel === "") return true;
        return !rel.split("/").some((segment) => excluded.has(segment)) && !excluded.has(rel);
      },
    });
    rewritePackageName(path.join(targetDir, "package.json"), options.projectName);
  }

  private manifestFor(dirName: string): TemplateManifest | undefined {
    const dir = path.join(this.rootDir, dirName);
    const file = path.join(dir, "template.json");
    if (!existsSync(file) || !statSync(dir).isDirectory()) return undefined;
    const parsed = TemplateManifestSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) {
      throw new AppError(
        "internal",
        "template.invalid_manifest",
        `Template "${dirName}" has an invalid manifest.`,
        {
          details: { issues: parsed.error.issues },
        },
      );
    }
    return parsed.data;
  }
}

function stripManifestOnlyFields(manifest: TemplateManifest): Template {
  const template: Template & { exclude?: string[] } = { ...manifest };
  delete template.exclude;
  return template;
}

function rewritePackageName(file: string, projectName: string): void {
  if (!existsSync(file)) return;
  const pkg = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  pkg["name"] = packageNameFor(projectName);
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

export function packageNameFor(projectName: string): string {
  const name = projectName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 100);
  return name.length > 0 ? name : "app";
}

export class TemplateRegistry {
  constructor(private readonly sources: readonly TemplateSource[]) {}

  list(): Template[] {
    return this.sources.flatMap((s) => s.list());
  }

  materialize(templateId: string, targetDir: string, options: MaterializeOptions): void {
    for (const source of this.sources) {
      if (source.list().some((t) => t.id === templateId)) {
        source.materialize(templateId, targetDir, options);
        return;
      }
    }
    throw new AppError("not_found", "template.not_found", `Unknown template "${templateId}".`);
  }
}
