import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = (name: string) => path.resolve(here, "../../packages", name, "src/index.ts");

const manifest = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
const workspacePackages = Object.keys(manifest.dependencies ?? {})
  .filter((dep) => dep.startsWith("@autoappz/"))
  .map((dep) => dep.slice("@autoappz/".length));

/**
 * Exact-match aliases for every workspace dependency of the desktop app (source exports, ADR-012).
 * Subpath imports such as `@autoappz/ui/ui.css` still resolve via the workspace package itself.
 */
export const alias = workspacePackages.map((name) => ({
  find: new RegExp(`^@autoappz/${name}$`),
  replacement: pkg(name),
}));
