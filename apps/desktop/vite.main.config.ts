import { defineConfig } from "vite";
import { alias } from "./vite.alias.ts";

export default defineConfig({
  resolve: { alias },
  build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    sourcemap: true,
    lib: { entry: "src/main/index.ts", formats: ["cjs"], fileName: () => "main.cjs" },
    rollupOptions: { external: ["electron", /^node:/] },
    target: "node22",
  },
});
