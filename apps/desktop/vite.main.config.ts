import { defineConfig } from "vite";
import { alias } from "./vite.alias.ts";

export default defineConfig({
  resolve: { alias },
  build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    sourcemap: true,
    lib: { entry: "src/main/index.ts", formats: ["cjs"], fileName: () => "main.cjs" },
    // Native modules stay external and are resolved from node_modules at runtime.
    rollupOptions: { external: ["electron", "better-sqlite3", "@vscode/ripgrep", /^node:/] },
    target: "node22",
  },
});
