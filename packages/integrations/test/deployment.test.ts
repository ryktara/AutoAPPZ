import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTempDir } from "@autoappz/testing";
import {
  buildReadiness,
  cloudflareAdapter,
  collectFiles,
  createDockerAdapter,
  detectFramework,
  digest,
  imageTagFor,
  netlifyAdapter,
  renderDockerfile,
  vercelAdapter,
  type DeployEvent,
  type DeploymentAdapter,
  type DeploymentTarget,
  type FrameworkInfo,
} from "../src/index.ts";

function writeProject(root: string, files: Record<string, string>): void {
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), content);
  }
}

const target = (
  adapterId: DeploymentTarget["adapterId"],
  config: Record<string, string> = {},
): DeploymentTarget => ({
  id: "tgt_1",
  projectId: "p1",
  adapterId,
  name: "prod",
  config,
  secretId: "sec_1",
  envSecrets: {},
  updatedAt: 0,
});

async function collect(events: AsyncIterable<DeployEvent>): Promise<DeployEvent[]> {
  const out: DeployEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe("framework detection", () => {
  it("recognises vite, next (static export), node servers and static folders", async () => {
    await withTempDir((dir) => {
      writeProject(dir, {
        "package.json": JSON.stringify({ scripts: { build: "vite build" }, devDependencies: { vite: "5" } }),
        "pnpm-lock.yaml": "",
      });
      expect(detectFramework(dir)).toMatchObject({
        framework: "vite",
        outputDir: "dist",
        static: true,
        packageManager: "pnpm",
        hasBuildScript: true,
      });
      writeProject(dir, {
        "package.json": JSON.stringify({
          scripts: { build: "next build", start: "next start" },
          dependencies: { next: "16" },
        }),
        "next.config.ts": 'export default { output: "export" };',
      });
      expect(detectFramework(dir)).toMatchObject({ framework: "nextjs", outputDir: "out", static: true });
      writeProject(dir, { "next.config.ts": "export default {};" });
      expect(detectFramework(dir)).toMatchObject({ framework: "nextjs", outputDir: ".next", static: false });
      writeProject(dir, {
        "package.json": JSON.stringify({
          scripts: { build: "vite build", start: "tsx server/start.ts" },
          dependencies: { "@hono/node-server": "1", vite: "5" },
        }),
      });
      expect(detectFramework(dir)).toMatchObject({ framework: "node", static: false, hasStartScript: true });
      return Promise.resolve();
    });
    await withTempDir((dir) => {
      writeProject(dir, { "index.html": "<h1>hi</h1>" });
      expect(detectFramework(dir)).toMatchObject({ framework: "static", outputDir: ".", static: true });
      return Promise.resolve();
    });
  });

  it("collects upload files without dependencies, VCS data or secrets, and hashes them", async () => {
    await withTempDir((dir) => {
      writeProject(dir, {
        "index.html": "<h1>hi</h1>",
        "assets/app.js": "console.log(1)",
        "node_modules/x/index.js": "no",
        ".git/HEAD": "ref",
        ".env": "SECRET=1",
        "server.key": "k",
      });
      const files = collectFiles(dir);
      expect(files.map((f) => f.path)).toEqual(["assets/app.js", "index.html"]);
      expect(digest(files[1]!, "sha1")).toMatch(/^[0-9a-f]{40}$/);
      expect(digest(files[1]!, "sha256")).toMatch(/^[0-9a-f]{64}$/);
      return Promise.resolve();
    });
  });

  it("renders framework-aware Dockerfiles", () => {
    const vite: FrameworkInfo = {
      framework: "vite",
      outputDir: "dist",
      hasBuildScript: true,
      hasStartScript: false,
      static: true,
      packageManager: "pnpm",
    };
    const viteFile = renderDockerfile(vite);
    expect(viteFile).toContain("FROM nginx:alpine");
    expect(viteFile).toContain("COPY --from=build /app/dist /usr/share/nginx/html");
    expect(viteFile).toContain("pnpm run build");
    const node: FrameworkInfo = {
      ...vite,
      framework: "node",
      static: false,
      hasStartScript: true,
      packageManager: "npm",
    };
    const nodeFile = renderDockerfile(node);
    expect(nodeFile).toContain("then npm ci; else npm install; fi");
    expect(nodeFile).toContain('CMD ["npm", "run", "start"]');
    expect(nodeFile).toContain("EXPOSE 3000");
    expect(renderDockerfile({ ...vite, framework: "nextjs", outputDir: ".next", static: false })).toContain(
      'CMD ["pnpm", "run", "start"]',
    );
    expect(imageTagFor("D:\\apps\\My Shop", undefined)).toBe("my-shop:latest");
    expect(imageTagFor("/x/app", "custom:1")).toBe("custom:1");
  });
});

describe("readiness checklist", () => {
  it("fails on missing credential/config/env, warns on dirty tree, includes adapter items", async () => {
    await withTempDir(async (dir) => {
      writeProject(dir, { "package.json": JSON.stringify({ scripts: {}, devDependencies: { vite: "5" } }) });
      const framework = detectFramework(dir);
      const report = await buildReadiness({
        projectRoot: dir,
        target: target("vercel", {}),
        adapter: vercelAdapter,
        framework,
        secret: undefined,
        env: [
          { name: "DATABASE_URL", required: true, resolved: false },
          { name: "ANALYTICS_ID", required: false, resolved: false },
        ],
        git: { isRepository: true, dirty: 2 },
        lastValidation: { ok: false, summary: "typecheck failed (1)" },
      });
      const byId = Object.fromEntries(report.items.map((i) => [i.id, i.status]));
      expect(byId).toMatchObject({
        framework: "ok",
        "build-script": "fail",
        credential: "fail",
        "config:projectName": "fail",
        "env:DATABASE_URL": "fail",
        "env:ANALYTICS_ID": "warn",
        git: "warn",
        checks: "warn",
      });
      expect(report.ready).toBe(false);
      const docker = createDockerAdapter({ resolveDocker: () => undefined });
      const dockerReport = await buildReadiness({
        projectRoot: dir,
        target: target("docker"),
        adapter: docker,
        framework,
        secret: undefined,
        env: [],
        git: undefined,
      });
      expect(dockerReport.items.find((i) => i.id === "docker:cli")?.status).toBe("fail");
    });
  });
});

/** Mocked provider APIs: records requests, answers the shapes the adapters rely on. */
function mockProviders() {
  const calls: { method: string; url: string; auth: string; body: string }[] = [];
  let netlifyPolls = 0;
  let vercelPolls = 0;
  let cfPolls = 0;
  const server: Server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const url = req.url ?? "";
      calls.push({
        method: req.method ?? "",
        url,
        auth: req.headers.authorization ?? "",
        body: body.slice(0, 200),
      });
      const json = (status: number, data: unknown): boolean => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(data));
        return true;
      };
      if (req.headers.authorization === "Bearer bad")
        return json(401, { error: { message: "invalid token" } });
      // ---- vercel
      if (url.startsWith("/vercel/v9/projects"))
        return json(200, { projects: [{ id: "prj_1", name: "shop" }] });
      if (url.startsWith("/vercel/v10/projects/shop/env")) return json(201, { created: [] });
      if (url.startsWith("/vercel/v2/files")) return json(url.includes("dup") ? 409 : 200, {});
      if (url === "/vercel/v13/deployments" && req.method === "POST")
        return json(200, { id: "dpl_1", url: "shop-abc.vercel.app", readyState: "QUEUED" });
      if (url.startsWith("/vercel/v13/deployments/dpl_1"))
        return json(200, {
          id: "dpl_1",
          url: "shop-abc.vercel.app",
          readyState: ++vercelPolls >= 2 ? "READY" : "BUILDING",
        });
      // ---- netlify
      if (url.startsWith("/netlify/sites?"))
        return json(200, [
          { id: "site_1", name: "shop", ssl_url: "https://shop.netlify.app", account_slug: "acme" },
        ]);
      if (url === "/netlify/sites/site_1")
        return json(200, {
          id: "site_1",
          name: "shop",
          ssl_url: "https://shop.netlify.app",
          account_slug: "acme",
        });
      if (url.startsWith("/netlify/accounts/acme/env")) return json(201, []);
      if (url === "/netlify/sites/site_1/deploys" && req.method === "POST") {
        const files = (JSON.parse(body) as { files: Record<string, string> }).files;
        return json(200, { id: "dep_1", state: "uploading", required: [files["/index.html"]] });
      }
      if (url.startsWith("/netlify/deploys/dep_1/files/")) return json(200, {});
      if (url === "/netlify/deploys/dep_1")
        return json(200, {
          id: "dep_1",
          state: ++netlifyPolls >= 2 ? "ready" : "processing",
          ssl_url: "https://shop.netlify.app",
        });
      // ---- cloudflare
      if (url === "/cf/accounts")
        return json(200, { success: true, result: [{ id: "acc_1", name: "Acme" }] });
      if (url === "/cf/accounts/acc_1/pages/projects" && req.method === "GET")
        return json(200, { success: true, result: [{ name: "shop", subdomain: "shop.pages.dev" }] });
      if (url === "/cf/accounts/acc_1/pages/projects" && req.method === "POST")
        return json(200, { success: true, result: { name: "shop" } });
      if (url === "/cf/accounts/acc_1/pages/projects/shop" && req.method === "GET")
        return json(404, { success: false, errors: [{ message: "not found" }] });
      if (url === "/cf/accounts/acc_1/pages/projects/shop" && req.method === "PATCH")
        return json(200, { success: true, result: {} });
      if (url === "/cf/accounts/acc_1/pages/projects/shop/upload-token")
        return json(200, { success: true, result: { jwt: "jwt-1" } });
      if (url === "/cf/pages/assets/check-missing")
        return json(200, {
          success: true,
          result: (JSON.parse(body) as { hashes: string[] }).hashes.slice(0, 1),
        });
      if (url === "/cf/pages/assets/upload" || url === "/cf/pages/assets/upsert-hashes")
        return json(200, { success: true, result: true });
      if (url === "/cf/accounts/acc_1/pages/projects/shop/deployments" && req.method === "POST")
        return json(200, {
          success: true,
          result: {
            id: "cfd_1",
            url: "https://abc.shop.pages.dev",
            latest_stage: { name: "queued", status: "active" },
          },
        });
      if (url === "/cf/accounts/acc_1/pages/projects/shop/deployments/cfd_1")
        return json(200, {
          success: true,
          result: {
            id: "cfd_1",
            url: "https://abc.shop.pages.dev",
            latest_stage: { name: "deploy", status: ++cfPolls >= 2 ? "success" : "active" },
          },
        });
      return json(404, { error: `unhandled ${req.method ?? ""} ${url}` });
    });
  });
  return { server, calls };
}

describe("provider adapters against mocked APIs", () => {
  const mock = mockProviders();
  let base = "";
  beforeAll(async () => {
    await new Promise<void>((r) => mock.server.listen(0, "127.0.0.1", r));
    const address = mock.server.address();
    base = typeof address === "object" && address ? `http://127.0.0.1:${String(address.port)}` : "";
  });
  afterAll(async () => {
    await new Promise<void>((r) => mock.server.close(() => r()));
  });

  const run = async (
    adapter: DeploymentAdapter,
    t: DeploymentTarget,
    root: string,
    apiBase: string,
    extra: Partial<Parameters<DeploymentAdapter["deploy"]>[0]> = {},
  ) => {
    const framework = detectFramework(root);
    const events = await collect(
      adapter.deploy({
        projectRoot: root,
        target: t,
        framework,
        secret: "tok-1",
        env: { DATABASE_URL: "postgresql://x" },
        signal: new AbortController().signal,
        build: () => {
          mkdirSync(path.join(root, framework.outputDir), { recursive: true });
          writeFileSync(path.join(root, framework.outputDir, "index.html"), "<h1>built</h1>");
          writeFileSync(path.join(root, framework.outputDir, "app.js"), "console.log('x')");
          return Promise.resolve({ ok: true, outputDir: framework.outputDir });
        },
        apiBase,
        pollIntervalMs: 5,
        ...extra,
      }),
    );
    return events;
  };

  it("vercel: syncs env, uploads source files (skipping output), creates and polls the deployment", async () => {
    await withTempDir(async (dir) => {
      writeProject(dir, {
        "package.json": JSON.stringify({ scripts: { build: "vite build" }, devDependencies: { vite: "5" } }),
        "src/main.ts": "x",
        "dist/old.js": "stale",
        "node_modules/x.js": "no",
      });
      const events = await run(
        vercelAdapter,
        target("vercel", { projectName: "shop" }),
        dir,
        `${base}/vercel`,
      );
      const done = events.find((e) => e.kind === "done");
      expect(done).toMatchObject({ kind: "done", url: "https://shop-abc.vercel.app", providerRef: "dpl_1" });
      const steps = events
        .filter((e) => e.kind === "step" && e.status === "done")
        .map((e) => (e as { name: string }).name);
      expect(steps).toEqual(["Sync environment", "Upload source", "Create deployment", "Build on Vercel"]);
      const uploads = mock.calls.filter((c) => c.url.startsWith("/vercel/v2/files"));
      expect(uploads).toHaveLength(2); // package.json + src/main.ts; dist and node_modules skipped
      const create = mock.calls.find((c) => c.url === "/vercel/v13/deployments");
      expect(create?.body).toContain('"name":"shop"');
      expect(mock.calls.every((c) => c.auth === "Bearer tok-1")).toBe(true);
      const sites = await vercelAdapter.discover!("tok-1", new AbortController().signal, `${base}/vercel`);
      expect(sites).toEqual([{ id: "prj_1", name: "shop", config: { projectName: "shop" } }]);
    });
  }, 30_000);

  it("netlify: builds, uploads only files the site is missing, waits for ready", async () => {
    await withTempDir(async (dir) => {
      writeProject(dir, {
        "package.json": JSON.stringify({ scripts: { build: "vite build" }, devDependencies: { vite: "5" } }),
      });
      mock.calls.length = 0;
      const events = await run(
        netlifyAdapter,
        target("netlify", { siteId: "site_1" }),
        dir,
        `${base}/netlify`,
      );
      expect(events.find((e) => e.kind === "done")).toMatchObject({
        url: "https://shop.netlify.app",
        providerRef: "dep_1",
      });
      const uploads = mock.calls.filter(
        (c) => c.method === "PUT" && c.url.startsWith("/netlify/deploys/dep_1/files/"),
      );
      expect(uploads.map((u) => u.url)).toEqual(["/netlify/deploys/dep_1/files/index.html"]); // app.js was not "required"
      expect(mock.calls.some((c) => c.url.startsWith("/netlify/accounts/acme/env"))).toBe(true);
      const readiness = await netlifyAdapter.readiness({
        projectRoot: dir,
        target: target("netlify"),
        framework: { ...detectFramework(dir), framework: "node", static: false },
        secret: "t",
      });
      expect(readiness[0]?.status).toBe("fail");
    });
  }, 30_000);

  it("cloudflare: creates the project when missing, uploads missing assets by hash, creates and polls the deployment", async () => {
    await withTempDir(async (dir) => {
      writeProject(dir, {
        "package.json": JSON.stringify({ scripts: { build: "vite build" }, devDependencies: { vite: "5" } }),
      });
      mock.calls.length = 0;
      const events = await run(
        cloudflareAdapter,
        target("cloudflare", { accountId: "acc_1", projectName: "shop" }),
        dir,
        `${base}/cf`,
      );
      expect(events.find((e) => e.kind === "done")).toMatchObject({
        url: "https://abc.shop.pages.dev",
        providerRef: "cfd_1",
      });
      const names = events
        .filter((e) => e.kind === "step" && e.status === "done")
        .map((e) => (e as { name: string }).name);
      expect(names).toEqual([
        "Build",
        "Create project",
        "Sync environment",
        "Upload output",
        "Create deployment",
        "Publish",
      ]);
      const upload = mock.calls.find((c) => c.url === "/cf/pages/assets/upload");
      expect(upload?.auth).toBe("Bearer jwt-1");
      const sites = await cloudflareAdapter.discover!("tok-1", new AbortController().signal, `${base}/cf`);
      expect(sites).toEqual([
        {
          id: "acc_1/shop",
          name: "Acme / shop",
          url: "https://shop.pages.dev",
          config: { accountId: "acc_1", projectName: "shop" },
        },
      ]);
    });
  }, 30_000);

  it("rejects bad tokens with a clear error and never retries", async () => {
    await withTempDir(async (dir) => {
      writeProject(dir, { "package.json": "{}" });
      mock.calls.length = 0;
      await expect(
        collect(
          vercelAdapter.deploy({
            projectRoot: dir,
            target: target("vercel", { projectName: "shop" }),
            framework: detectFramework(dir),
            secret: "bad",
            env: {},
            signal: new AbortController().signal,
            build: () => Promise.resolve({ ok: true, outputDir: "dist" }),
            apiBase: `${base}/vercel`,
          }),
        ),
      ).rejects.toMatchObject({ code: "deploy.unauthorized" });
      expect(mock.calls.filter((c) => c.auth === "Bearer bad")).toHaveLength(1);
    });
  });
});

describe("docker adapter", () => {
  it("generates a Dockerfile and .dockerignore, builds via the CLI as an argument array, and returns the run hint", async () => {
    await withTempDir(async (dir) => {
      writeProject(dir, {
        "package.json": JSON.stringify({ scripts: { build: "vite build" }, devDependencies: { vite: "5" } }),
      });
      const invocations: { file: string; args: readonly string[] }[] = [];
      const adapter = createDockerAdapter({
        resolveDocker: () => ({ file: "/usr/bin/docker", args: [] }),
        run: (input) => {
          invocations.push({ file: input.file, args: input.args });
          input.onLine?.("stdout", "Step 1/6 : FROM node:24-alpine");
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 });
        },
      });
      const events = await collect(
        adapter.deploy({
          projectRoot: dir,
          target: target("docker", {}),
          framework: detectFramework(dir),
          secret: undefined,
          env: { API_URL: "x" },
          signal: new AbortController().signal,
          build: () => Promise.resolve({ ok: true, outputDir: "dist" }),
        }),
      );
      expect(existsSync(path.join(dir, "Dockerfile"))).toBe(true);
      expect(readFileSync(path.join(dir, ".dockerignore"), "utf8")).toContain("node_modules");
      expect(invocations[0]?.args).toEqual([
        "build",
        "--tag",
        `${path.basename(dir).toLowerCase()}:latest`,
        ".",
      ]);
      expect(events.some((e) => e.kind === "log" && e.text.includes("Step 1/6"))).toBe(true);
      const done = events.find((e) => e.kind === "done") as { hint?: string } | undefined;
      expect(done?.hint).toBe(
        `docker run --rm -p 8080:80 -e API_URL=… ${path.basename(dir).toLowerCase()}:latest`,
      );
      // an existing Dockerfile is respected, and a failing build is reported
      const failing = createDockerAdapter({
        resolveDocker: () => ({ file: "docker", args: [] }),
        run: () =>
          Promise.resolve({ exitCode: 1, stdout: "", stderr: "boom", timedOut: false, durationMs: 1 }),
      });
      await expect(
        collect(
          failing.deploy({
            projectRoot: dir,
            target: target("docker", { imageTag: "shop:1" }),
            framework: detectFramework(dir),
            secret: undefined,
            env: {},
            signal: new AbortController().signal,
            build: () => Promise.resolve({ ok: true, outputDir: "dist" }),
          }),
        ),
      ).rejects.toMatchObject({ code: "deploy.failed" });
    });
  });
});
