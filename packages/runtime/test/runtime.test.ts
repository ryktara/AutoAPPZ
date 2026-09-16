import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { runtime as contracts } from "@autoappz/contracts";
import { withTempDir } from "@autoappz/testing";
import {
  LineSplitter,
  PortLeaseRegistry,
  RuntimeSupervisor,
  SERVE_BAND,
  buildChildEnv,
  detectPackageManager,
  extractDiagnostic,
  injectScript,
  isAlive,
  resolveCmdShim,
  resolveExecutable,
  startPreviewProxy,
  stripAnsi,
  type PhaseCommand,
} from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "fake-dev-server.mjs");

function planner(extraArgs: Record<string, string[]> = {}, timeoutMs = 10_000) {
  return {
    packageManager: () => "pnpm" as const,
    planPhase: (_projectId: string, phase: contracts.Phase): Promise<PhaseCommand> =>
      Promise.resolve({
        command: { file: process.execPath, args: [FIXTURE] },
        args: extraArgs[phase] ?? [],
        cwd: here,
        portArgs: phase === "serve" ? (port: number) => ["--port", String(port)] : undefined,
        timeoutMs,
      }),
  };
}

const supervisors: RuntimeSupervisor[] = [];
function make(
  options: Partial<ConstructorParameters<typeof RuntimeSupervisor>[0]> & { planner: PhaseCommandPlanner },
) {
  const s = new RuntimeSupervisor({
    readinessIntervalMs: 50,
    healthIntervalMs: 60,
    degradedAfter: 3,
    backoffBaseMs: 20,
    backoffMaxMs: 100,
    killGraceMs: 1_000,
    ...options,
  });
  supervisors.push(s);
  return s;
}
type PhaseCommandPlanner = ReturnType<typeof planner>;

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((s) => s.stopAll()));
});

const until = async (cond: () => boolean, ms = 8_000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe("command resolution", () => {
  it("detects the package manager from declarations and lockfiles", async () => {
    await withTempDir(async (dir) => {
      expect(detectPackageManager(dir)).toBe("pnpm");
      writeFileSync(path.join(dir, "package-lock.json"), "{}");
      expect(detectPackageManager(dir)).toBe("npm");
      writeFileSync(path.join(dir, "yarn.lock"), "");
      expect(detectPackageManager(dir)).toBe("yarn");
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ packageManager: "bun@1.2.0" }));
      expect(detectPackageManager(dir)).toBe("bun");
      await Promise.resolve();
    });
  });

  it("resolves npm-style .cmd shims to node + entry without a shell", async () => {
    await withTempDir(async (dir) => {
      mkdirSync(path.join(dir, "node_modules", "pnpm", "bin"), { recursive: true });
      writeFileSync(path.join(dir, "node_modules", "pnpm", "bin", "pnpm.mjs"), "");
      const shim = path.join(dir, "pnpm.cmd");
      writeFileSync(shim, '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\pnpm\\bin\\pnpm.mjs" %*\r\n');
      const env = { PATH: path.dirname(process.execPath) };
      const resolved = resolveCmdShim(shim, env);
      expect(resolved?.args).toEqual([path.join(dir, "node_modules", "pnpm", "bin", "pnpm.mjs")]);
      expect(resolved?.file.toLowerCase()).toContain("node");
      expect(resolveExecutable("definitely-not-a-command-xyz", env)).toBeUndefined();
      expect(resolveExecutable(process.execPath, env)?.file).toBe(process.execPath);
      await Promise.resolve();
    });
  });

  it("child env is an allowlist with non-interactive defaults", () => {
    const env = buildChildEnv(
      { PATH: "/bin", HOME: "/home/u", SECRET_TOKEN: "x", OPENAI_API_KEY: "y" },
      { PORT: "41000" },
    );
    expect(env).toMatchObject({
      PATH: "/bin",
      HOME: "/home/u",
      CI: "1",
      PORT: "41000",
      NODE_ENV: "development",
    });
    expect(env).not.toHaveProperty("SECRET_TOKEN");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
  });
});

describe("output and diagnostics", () => {
  it("splits chunks into lines and strips ANSI", () => {
    const s = new LineSplitter();
    expect(s.push("a\r\nb\nc")).toEqual(["a", "b"]);
    expect(s.push("d\n")).toEqual(["cd"]);
    expect(s.flush()).toEqual([]);
    expect(stripAnsi("[31merror[0m")).toBe("error");
  });

  it.each([
    [
      "src/a.ts(3,5): error TS2322: Type 'x'",
      { source: "tsc", code: "TS2322", file: "src/a.ts", line: 3, column: 5 },
    ],
    ["src/a.ts:3:5 - error TS1005: ',' expected.", { source: "tsc", code: "TS1005", line: 3 }],
    ["ERR_PNPM_FETCH_404 GET https://x: Not Found", { source: "install", code: "ERR_PNPM_FETCH_404" }],
    ["npm ERR! code ERESOLVE", { source: "install", message: "code ERESOLVE" }],
    [
      'Failed to resolve import "./nope" from "src/App.tsx". Does the file exist?',
      { source: "vite", file: "src/App.tsx" },
    ],
    ["[vite] Internal server error: boom", { source: "vite", message: "boom" }],
    ["src/App.tsx:4:10: ERROR: Unexpected token", { source: "vite", line: 4, column: 10 }],
    ["Error: listen EADDRINUSE: address already in use", { source: "runtime", code: "EADDRINUSE" }],
    ["TypeError: x is not a function", { source: "runtime", code: "TypeError" }],
  ])("extracts %s", (line, expected) => {
    expect(extractDiagnostic("serve", line)).toMatchObject(expected);
  });

  it("ignores ordinary output", () => {
    expect(extractDiagnostic("serve", "  VITE v5.4.0  ready in 300 ms")).toBeUndefined();
    expect(extractDiagnostic("serve", "")).toBeUndefined();
  });
});

describe("ports", () => {
  it("skips ports owned by foreign processes and never kills them", async () => {
    const foreign = createServer();
    await new Promise<void>((r) => foreign.listen(SERVE_BAND.from, "127.0.0.1", r));
    try {
      const registry = new PortLeaseRegistry();
      const lease = await registry.lease("p1:serve", SERVE_BAND);
      expect(lease.port).toBeGreaterThan(SERVE_BAND.from);
      expect(lease.skipped).toContain(SERVE_BAND.from);
      expect(foreign.listening).toBe(true);
      const second = await registry.lease("p2:serve", SERVE_BAND);
      expect(second.port).not.toBe(lease.port);
      lease.release();
      expect(registry.ownerOf(lease.port)).toBeUndefined();
    } finally {
      await new Promise<void>((r) => foreign.close(() => r()));
    }
  });
});

describe("preview proxy", () => {
  it("injects the script into HTML only and proxies other content", async () => {
    const s = make({ planner: planner(), previewProxy: false });
    const info = await s.start("p1", "serve");
    expect(info.state).toBe("RUNNING");
    const proxy = await startPreviewProxy({ port: 0, targetPort: info.port! });
    try {
      const html = await (await fetch(`${proxy.url}index.html`)).text();
      expect(html).toContain('<script src="/__autoappz/preview.js"></script>');
      expect(html.indexOf("<script")).toBeLessThan(html.indexOf("<title>"));
      const text = await (await fetch(`${proxy.url}api`)).text();
      expect(text).toBe("ok");
      const script = await (await fetch(`${proxy.url}__autoappz/preview.js`)).text();
      expect(script).toContain("unhandledrejection");
      expect(script).not.toContain("localStorage");
    } finally {
      await proxy.close();
    }
    expect(injectScript("<p>no head</p>")).toContain("preview.js");
  });
});

describe("RuntimeSupervisor", () => {
  it("serve: leases a port, becomes RUNNING after an HTTP probe, exposes a preview URL, stops cleanly", async () => {
    const s = make({ planner: planner() });
    const states: string[] = [];
    s.onStateChanged((p) => states.push(p.state));
    const info = await s.start("p1", "serve");
    expect(info.state).toBe("RUNNING");
    expect(info.port).toBeGreaterThanOrEqual(SERVE_BAND.from);
    expect(info.previewUrl).toMatch(/^http:\/\/127\.0\.0\.1:42\d{3}\/$/);
    expect(s.status("p1").previewUrl).toBe(info.previewUrl);
    const html = await (await fetch(info.previewUrl!)).text();
    expect(html).toContain("preview.js");
    expect(s.logs("p1", { phase: "serve" }).some((l) => l.text.includes("Ready at"))).toBe(true);
    const pid = info.pid!;
    await s.stop("p1", "serve");
    expect(s.status("p1").processes.find((p) => p.phase === "serve")?.state).toBe("STOPPED");
    expect(isAlive(pid)).toBe(false);
    expect(states).toEqual(["STARTING", "RUNNING", "STOPPING", "STOPPED"]);
  });

  it("install: attributes failures to the phase with structured diagnostics", async () => {
    const s = make({ planner: planner({ install: ["--fail"] }) });
    const diags: contracts.RuntimeDiagnostic[] = [];
    s.onDiagnostic((d) => diags.push(d));
    await s.start("p1", "install");
    await until(() => s.status("p1").processes.find((p) => p.phase === "install")?.state === "CRASHED");
    const install = s.status("p1").processes.find((p) => p.phase === "install")!;
    expect(install.exit).toMatchObject({ code: 2, classified: "error" });
    expect(install.lastError).toContain("install failed");
    expect(diags.map((d) => d.code ?? d.source)).toEqual(
      expect.arrayContaining(["TS2322", "ERR_PNPM_FETCH_404"]),
    );
    expect(diags.every((d) => d.phase === "install")).toBe(true);
  });

  it("degrades when health probes fail and recovers detection state", async () => {
    const s = make({ planner: planner({ serve: ["--hang-after", "200"] }) });
    const info = await s.start("p1", "serve");
    expect(info.state).toBe("RUNNING");
    await until(
      () => s.status("p1").processes.find((p) => p.phase === "serve")?.state === "DEGRADED",
      15_000,
    );
    expect(
      s.status("p1").processes.find((p) => p.phase === "serve")?.health?.failures,
    ).toBeGreaterThanOrEqual(3);
  });

  it("restarts a crashed serve process with backoff, then gives up after the limit", async () => {
    const s = make({ planner: planner({ serve: ["--crash-after", "600"] }), maxAutoRestarts: 2 });
    const states: string[] = [];
    s.onStateChanged((p) => states.push(p.state));
    const info = await s.start("p1", "serve");
    expect(info.state).toBe("RUNNING");
    await until(() => s.status("p1").processes.find((p) => p.phase === "serve")?.state === "CRASHED", 20_000);
    const serve = s.status("p1").processes.find((p) => p.phase === "serve")!;
    expect(serve.restarts).toBe(2);
    expect(serve.lastError).toContain("not restarting");
    expect(states.filter((x) => x === "RESTARTING")).toHaveLength(2);
  });

  it("a serve process that exits before readiness is CRASHED without restarts", async () => {
    const s = make({ planner: planner({ serve: ["--fail"] }) });
    await s.start("p1", "serve").catch(() => undefined);
    await until(() => s.status("p1").processes.find((p) => p.phase === "serve")?.state === "CRASHED");
    expect(s.status("p1").processes.find((p) => p.phase === "serve")?.restarts).toBe(0);
  });

  it("terminates the whole process tree", async () => {
    const s = make({ planner: planner({ serve: ["--spawn-child"] }), previewProxy: false });
    const info = await s.start("p1", "serve");
    await until(() => s.logs("p1").some((l) => l.text.startsWith("child ")));
    const childPid = Number(
      s
        .logs("p1")
        .find((l) => l.text.startsWith("child "))!
        .text.split(" ")[1],
    );
    expect(isAlive(childPid)).toBe(true);
    await s.stop("p1", "serve");
    await until(() => !isAlive(childPid), 6_000);
    expect(isAlive(info.pid!)).toBe(false);
  });

  it("refuses to start a phase twice and records preview events as diagnostics", async () => {
    const s = make({ planner: planner(), previewProxy: false });
    await s.start("p1", "serve");
    await expect(s.start("p1", "serve")).rejects.toMatchObject({ code: "runtime.already_running" });
    s.reportPreviewEvent("p1", {
      type: "error",
      message: "boom at render",
      stack: "Error: boom\n at App",
      at: 1,
    });
    s.reportPreviewEvent("p1", { type: "navigation", url: "http://x/", at: 2 });
    const diags = s.diagnostics("p1");
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({ source: "preview", severity: "error", message: "boom at render" });
    s.clearDiagnostics("p1");
    expect(s.diagnostics("p1")).toEqual([]);
  });
});
