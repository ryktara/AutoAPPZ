import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = (name: string) => path.join(root, "packages", name, "src", "index.ts");
const PACKAGES = [
  "contracts",
  "command-bus",
  "core",
  "agent",
  "ai-providers",
  "tools",
  "project",
  "runtime",
  "git",
  "storage",
  "secrets",
  "diagnostics",
  "permissions",
  "validation",
  "context",
  "integrations",
  "plugins",
  "ui",
  "testing",
];

export default defineConfig({
  resolve: {
    // Exact-match aliases so subpath imports (e.g. @autoappz/ui/ui.css) resolve through the workspace package.
    alias: PACKAGES.map((name) => ({ find: new RegExp("^@autoappz/" + name + "$"), replacement: pkg(name) })),
  },
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "packages/*/test/**/*.test.tsx",
      "tests/integration/**/*.test.ts",
      "tests/security/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "_reference/**", "tests/e2e/**", "**/test/fixtures/**"],
    environment: "node",
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/index.ts"],
      reporter: ["text", "json-summary"],
    },
  },
});
