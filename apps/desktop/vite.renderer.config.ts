import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { alias } from "./vite.alias.ts";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  resolve: { alias },
  build: {
    outDir: "../../.vite/renderer/main_window",
    emptyOutDir: true,
    sourcemap: true,
    target: "chrome130",
  },
});
