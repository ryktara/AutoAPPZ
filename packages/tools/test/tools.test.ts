import fc from "fast-check";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { permissions as contracts } from "@autoappz/contracts";
import { Redactor } from "@autoappz/diagnostics";
import { PermissionEngine } from "@autoappz/permissions";
import { withTempDir } from "@autoappz/testing";
import {
  FS_TOOLS,
  ReadLedger,
  ToolRuntime,
  applyEdits,
  contentHash,
  createSearchTool,
  normalizeRelative,
  resolveProjectPath,
} from "../src/index.ts";

function memoryStore() {
  const rows: contracts.Policy[] = [];
  return {
    rows,
    list: () => rows,
    insert: (p: contracts.Policy) => {
      rows.push(p);
    },
    delete: () => false,
  };
}

function harness(root: string, opts: { autoAllow?: boolean } = {}) {
  const audit: contracts.ToolCallAudit[] = [];
  const store = memoryStore();
  if (opts.autoAllow) {
    store.rows.push({
      id: "allow-all-write",
      capability: "fs.write",
      scopePattern: "**",
      decision: "allow",
      lifetime: "project",
      createdAt: 0,
    });
  }
  const engine = new PermissionEngine({ store, consentTimeoutMs: 30 });
  const runtime = new ToolRuntime({
    tools: [...FS_TOOLS, createSearchTool()],
    permissions: engine,
    audit: { record: (e) => audit.push(e) },
    redactor: new Redactor(),
    maxSummaryChars: 2_000,
  });
  const ledger = new ReadLedger();
  const call = (toolId: string, input: unknown, signal = new AbortController().signal) =>
    runtime.execute({ toolId, input, projectId: "p1", projectRoot: root, taskId: "t1", signal, ledger });
  return { runtime, engine, audit, ledger, call };
}

describe("path policy", () => {
  it.each(["/etc/passwd", "C:\\Windows", "\\\\server\\share", "~/x", "../x", "a/../../b", "", "a\0b"])(
    "rejects %j",
    (p) => {
      expect(() => normalizeRelative(p)).toThrow();
    },
  );
  it("normalises separators and dots", () => {
    expect(normalizeRelative("./src\\app/./x.ts")).toBe("src/app/x.ts");
  });
  it("never escapes the root (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.constant(".."), fc.constant("."), fc.stringMatching(/^[a-z0-9_.-]{1,8}$/)), {
          minLength: 1,
          maxLength: 8,
        }),
        (segments) => {
          const input = segments.join("/");
          try {
            const rel = normalizeRelative(input);
            expect(rel.split("/")).not.toContain("..");
            expect(rel.startsWith("/")).toBe(false);
          } catch {
            expect(segments.includes("..") || segments.every((s) => s === ".")).toBe(true);
          }
        },
      ),
    );
  });
  it("rejects symlinks that point outside the project and .git writes", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "proj");
      const outside = path.join(dir, "outside");
      mkdirSync(root, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(path.join(outside, "secret.txt"), "x");
      let linked = true;
      try {
        symlinkSync(outside, path.join(root, "link"), "junction");
      } catch {
        linked = false; // symlink creation may be restricted; the rest still runs
      }
      if (linked) {
        expect(() => resolveProjectPath(root, "link/secret.txt")).toThrow(/outside the project/);
      }
      expect(() => resolveProjectPath(root, ".git/config", { forWrite: true })).toThrow(/\.git/);
      expect(resolveProjectPath(root, "src/new/file.ts").relative).toBe("src/new/file.ts");
      await Promise.resolve();
    });
  });
});

describe("applyEdits", () => {
  it("requires unique matches unless occurrence is given, and is atomic", () => {
    const dup = applyEdits("a b a", [{ find: "a", replace: "c" }]);
    expect("error" in dup && dup.error).toContain("occurs 2 times");
    expect(applyEdits("a b a", [{ find: "a", replace: "c", occurrence: 2 }])).toEqual({ content: "a b c" });
    const missing = applyEdits("a b", [
      { find: "a", replace: "c" },
      { find: "zzz", replace: "" },
    ]);
    expect("error" in missing && `${missing.error}#${String(missing.index)}`).toContain("not found#1");
  });
});

describe("ToolRuntime with fs tools", () => {
  it("reads, lists, outlines and searches without consent; every call is audited", async () => {
    await withTempDir(async (root) => {
      mkdirSync(path.join(root, "src"));
      writeFileSync(
        path.join(root, "src", "a.ts"),
        "export function hello() {}\nconst secret = 1;\nexport class Thing {}\n",
      );
      writeFileSync(path.join(root, ".env"), "API_KEY=sk-abcdefghijklmnopqrstuvwxyz\n");
      const { call, audit } = harness(root);
      const read = await call("fs.read", { path: "src/a.ts" });
      expect(read.ok).toBe(true);
      expect(read.summaryForModel).toContain("1| export function hello");
      const list = await call("fs.list", { path: "." });
      expect(list.ok && (list.value as { entries: { path: string }[] }).entries.map((e) => e.path)).toEqual([
        ".env",
        "src",
        "src/a.ts",
      ]);
      const outline = await call("fs.outline", { path: "src/a.ts" });
      expect(outline.summaryForModel).toContain("3: class Thing");
      const search = await call("search.text", { query: "hello" });
      expect(search.summaryForModel).toContain("src/a.ts:1");
      const envRead = await call("fs.read", { path: ".env" });
      expect(envRead.ok).toBe(false);
      expect(envRead.summaryForModel).toContain("secrets");
      const envSearch = await call("search.text", { query: "API_KEY" });
      expect(envSearch.summaryForModel).toBe('No matches for "API_KEY".');
      expect(audit).toHaveLength(6);
      expect(audit.every((a) => a.decision === "allow" && a.decisionSource === "default")).toBe(true);
      expect(JSON.stringify(audit)).not.toContain("abcdefghijklmnopqrstuvwxyz");
    });
  });

  it("writes need consent; denial is audited and explained to the model", async () => {
    await withTempDir(async (root) => {
      const { call, engine, audit } = harness(root);
      const pending = call("fs.write", { path: "src/new.ts", content: "export {}\n" });
      await new Promise((r) => setTimeout(r, 0));
      const req = engine.pending("p1")[0]!;
      expect(req).toMatchObject({
        toolId: "fs.write",
        risk: "medium",
        description: "Write src/new.ts (10 chars)",
      });
      engine.respond(req.id, "deny");
      const result = await pending;
      expect(result.ok).toBe(false);
      expect(result.summaryForModel).toContain("not allowed");
      expect(existsSync(path.join(root, "src", "new.ts"))).toBe(false);
      expect(audit.at(-1)).toMatchObject({
        toolId: "fs.write",
        decision: "deny",
        decisionSource: "user",
        ok: false,
      });
    });
  });

  it("enforces read-before-write and detects concurrent edits", async () => {
    await withTempDir(async (root) => {
      writeFileSync(path.join(root, "x.ts"), "one\n");
      const { call } = harness(root, { autoAllow: true });
      const blind = await call("fs.write", { path: "x.ts", content: "two\n" });
      expect(blind.ok).toBe(false);
      expect(blind.summaryForModel).toContain("Read x.ts before");
      const read = await call("fs.read", { path: "x.ts" });
      const hash = (read as { value: { hash: string } }).value.hash;
      writeFileSync(path.join(root, "x.ts"), "changed by user\n");
      const conflict = await call("fs.patch", { path: "x.ts", edits: [{ find: "one", replace: "two" }] });
      expect(conflict.ok).toBe(false);
      expect(conflict.summaryForModel).toContain("changed since it was read");
      const explicit = await call("fs.write", {
        path: "x.ts",
        content: "three\n",
        expectedHash: contentHash("changed by user\n"),
      });
      expect(explicit.ok).toBe(true);
      expect(readFileSync(path.join(root, "x.ts"), "utf8")).toBe("three\n");
      const patched = await call("fs.patch", { path: "x.ts", edits: [{ find: "three", replace: "four" }] });
      expect(patched.ok).toBe(true);
      expect(readFileSync(path.join(root, "x.ts"), "utf8")).toBe("four\n");
      expect(hash).not.toBe(contentHash("four\n"));
    });
  });

  it("delete is destructive: never auto-allowed even with a blanket project rule", async () => {
    await withTempDir(async (root) => {
      writeFileSync(path.join(root, "gone.ts"), "x");
      const { call, engine } = harness(root, { autoAllow: true });
      engine.policies("p1"); // store has only fs.write allow-all
      const result = await call("fs.delete", { path: "gone.ts" });
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ ok: false, error: { code: "tool.denied.timeout" } });
      expect(existsSync(path.join(root, "gone.ts"))).toBe(true);
    });
  });

  it("rejects invalid input, unknown tools, and bounds summaries", async () => {
    await withTempDir(async (root) => {
      writeFileSync(path.join(root, "big.txt"), "x".repeat(50_000));
      const { call, audit } = harness(root);
      expect(await call("fs.read", { nope: 1 })).toMatchObject({
        ok: false,
        error: { code: "tool.invalid_input" },
      });
      expect(await call("nope.tool", {})).toMatchObject({ ok: false, error: { code: "tool.unknown" } });
      const big = await call("fs.read", { path: "big.txt" });
      expect(big.summaryForModel.length).toBeLessThan(2_200);
      expect(big.summaryForModel).toContain("[truncated");
      expect(audit.map((a) => a.toolId)).toEqual(["fs.read", "fs.read"]);
    });
  });

  it("serialises writes per project and cancels via signal", async () => {
    await withTempDir(async (root) => {
      const { call } = harness(root, { autoAllow: true });
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          call("fs.write", { path: `f${String(i)}.txt`, content: String(i) }),
        ),
      );
      expect(results.every((r) => r.ok)).toBe(true);
      const ac = new AbortController();
      ac.abort();
      const cancelled = await call("fs.write", { path: "z.txt", content: "z" }, ac.signal);
      expect(cancelled.ok).toBe(false);
      expect(existsSync(path.join(root, "z.txt"))).toBe(false);
    });
  });

  it("every registered tool declares a permission descriptor, schemas and a timeout", () => {
    const runtime = new ToolRuntime({
      tools: [...FS_TOOLS, createSearchTool()],
      permissions: new PermissionEngine({ store: memoryStore() }),
      audit: { record: () => undefined },
      redactor: new Redactor(),
    });
    for (const t of runtime.list()) {
      expect(t.permission.capability).toBeTruthy();
      expect(["low", "medium", "high", "destructive"]).toContain(t.permission.risk);
      expect(t.timeoutMs).toBeGreaterThan(0);
      expect(t.mutates === (t.permission.capability !== "fs.read")).toBe(true);
    }
    const specs = runtime.specs();
    expect(specs.map((s) => s.name)).toContain("fs.patch");
    expect(specs.find((s) => s.name === "fs.read")?.inputSchema).toMatchObject({ type: "object" });
  });
});
