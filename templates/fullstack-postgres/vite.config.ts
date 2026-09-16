import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { getRequestListener } from "@hono/node-server";
import type { Hono } from "hono";

/** Serves the Hono API from the Vite dev server on /api, reloading server code on change. */
function apiPlugin(): Plugin {
  return {
    name: "api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api", async (req, res) => {
        const mod = (await server.ssrLoadModule("/server/app.ts")) as { app: Hono };
        req.url = `/api${req.url ?? ""}`;
        await getRequestListener(mod.app.fetch)(req, res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: { host: "127.0.0.1" },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"] },
});
