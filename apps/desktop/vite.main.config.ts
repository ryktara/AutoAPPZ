import { defineConfig } from "vite";
import { alias } from "./vite.alias.ts";

export default defineConfig({
  resolve: { alias },
  build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    sourcemap: true,
    lib: { entry: "src/main/index.ts", formats: ["cjs"], fileName: () => "main.cjs" },
    // Native modules and binary-shipping packages (dugite locates its git via __dirname) stay external.
    rollupOptions: {
      external: ["electron", "better-sqlite3", "@vscode/ripgrep", "dugite", "pg", "pg-native", /^node:/],
    },
    target: "node22",
  },
});
