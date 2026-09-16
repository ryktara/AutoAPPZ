import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = (name: string) => path.join(root, "packages", name, "src", "index.ts");

export default defineConfig({
  resolve: {
    alias: {
      "@autoappz/contracts": pkg("contracts"),
      "@autoappz/command-bus": pkg("command-bus"),
      "@autoappz/core": pkg("core"),
      "@autoappz/agent": pkg("agent"),
      "@autoappz/ai-providers": pkg("ai-providers"),
      "@autoappz/tools": pkg("tools"),
      "@autoappz/project": pkg("project"),
      "@autoappz/runtime": pkg("runtime"),
      "@autoappz/git": pkg("git"),
      "@autoappz/storage": pkg("storage"),
      "@autoappz/secrets": pkg("secrets"),
      "@autoappz/diagnostics": pkg("diagnostics"),
      "@autoappz/permissions": pkg("permissions"),
      "@autoappz/validation": pkg("validation"),
      "@autoappz/context": pkg("context"),
      "@autoappz/integrations": pkg("integrations"),
      "@autoappz/plugins": pkg("plugins"),
      "@autoappz/ui": pkg("ui"),
      "@autoappz/testing": pkg("testing"),
    },
  },
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "packages/*/test/**/*.test.tsx",
      "tests/integration/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "_reference/**", "tests/e2e/**"],
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
