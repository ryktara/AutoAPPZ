import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = (name: string) => path.resolve(here, "../../packages", name, "src/index.ts");

/** Exact-match aliases; subpath imports such as `@autoappz/ui/ui.css` resolve via the workspace package. */
export const alias = ["contracts", "command-bus", "diagnostics", "ui", "storage", "secrets", "core"].map(
  (name) => ({
    find: new RegExp(`^@autoappz/${name}$`),
    replacement: pkg(name),
  }),
);
