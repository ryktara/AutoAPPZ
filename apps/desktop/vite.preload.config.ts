import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    sourcemap: true,
    lib: { entry: "src/preload/index.ts", formats: ["cjs"], fileName: () => "preload.cjs" },
    rollupOptions: { external: ["electron"] },
    target: "node22",
  },
});
