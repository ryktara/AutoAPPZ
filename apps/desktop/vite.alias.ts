import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = (name: string) => path.resolve(here, "../../packages", name, "src/index.ts");
export const alias = {
  "@autoappz/contracts": pkg("contracts"),
  "@autoappz/command-bus": pkg("command-bus"),
  "@autoappz/diagnostics": pkg("diagnostics"),
  "@autoappz/ui": pkg("ui"),
};
