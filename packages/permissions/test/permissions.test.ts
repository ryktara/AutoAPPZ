import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { permissions as contracts } from "@autoappz/contracts";
import {
  PermissionEngine,
  globMatch,
  patternSpecificity,
  scopePatternFor,
  type PolicyStore,
} from "../src/index.ts";

describe("glob", () => {
  it.each([
    ["src/**", "src/a.ts", true],
    ["src/**", "src/x/y/z.ts", true],
    ["src/**", "src", false],
    ["**", "anything/at/all", true],
    ["**/*.test.ts", "a/b/c.test.ts", true],
    ["**/*.test.ts", "c.test.ts", true],
    ["*.ts", "a.ts", true],
    ["*.ts", "a/b.ts", false],
    ["src/?.ts", "src/a.ts", true],
    ["src/?.ts", "src/ab.ts", false],
    ["api.github.com", "api.github.com", true],
    ["*.github.com", "api.github.com", true],
    ["*.github.com", "evil.com", false],
    ["src/(x).ts", "src/(x).ts", true],
  ])("%s vs %s → %s", (pattern, value, expected) => {
    expect(globMatch(pattern, value)).toBe(expected);
  });

  it("literal patterns only match themselves (property)", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9_./-]{1,20}$/),
        fc.stringMatching(/^[a-z0-9_./-]{1,20}$/),
        (a, b) => {
          expect(globMatch(a, a)).toBe(true);
          if (a !== b) expect(globMatch(a, b)).toBe(false);
        },
      ),
    );
  });

  it("`**` matches every path and ranks least specific (property)", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9_./-]{1,30}$/), (p) => {
        expect(globMatch("**", p)).toBe(true);
        expect(patternSpecificity(p)).toBeGreaterThan(patternSpecificity("**"));
      }),
    );
  });
});

function memoryStore(): PolicyStore & { rows: contracts.Policy[] } {
  const rows: contracts.Policy[] = [];
  return {
    rows,
    list: (projectId) =>
      rows.filter((p) => p.projectId === undefined || p.projectId === projectId || projectId === ""),
    insert: (p) => {
      rows.push(p);
    },
    delete: (id) => {
      const i = rows.findIndex((p) => p.id === id);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
  };
}

const base = (over: Partial<Parameters<PermissionEngine["check"]>[0]> = {}) => ({
  projectId: "p1",
  taskId: "t1",
  toolId: "fs.write",
  capability: "fs.write" as const,
  scope: "src/App.tsx",
  risk: "medium" as const,
  defaultPolicy: "ask" as const,
  description: "Write src/App.tsx",
  signal: new AbortController().signal,
  ...over,
});

describe("PermissionEngine", () => {
  it("auto-allows low-risk defaults but never destructive ones", async () => {
    const engine = new PermissionEngine({ store: memoryStore(), consentTimeoutMs: 20 });
    expect(await engine.check(base({ capability: "fs.read", risk: "low", defaultPolicy: "allow" }))).toEqual({
      decision: "allow",
      source: "default",
    });
    const d = await engine.check(
      base({ capability: "fs.delete", risk: "destructive", defaultPolicy: "allow" }),
    );
    expect(d).toEqual({ decision: "deny", source: "timeout" });
  });

  it("parks medium-risk calls and applies the user's choice as a standing rule", async () => {
    const store = memoryStore();
    const requested: contracts.ConsentRequest[] = [];
    const engine = new PermissionEngine({
      store,
      onConsentRequested: (r) => requested.push(r),
      newId: () => `id_${String(requested.length + 1)}`,
      now: () => 1000,
    });
    const pending = engine.check(base());
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({
      toolId: "fs.write",
      scope: "src/App.tsx",
      risk: "medium",
      deadlineAt: 1000 + 5 * 60_000,
    });
    expect(engine.pending("p1")).toHaveLength(1);
    engine.respond(requested[0]!.id, "allow_project");
    expect(await pending).toMatchObject({ decision: "allow", source: "user" });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      capability: "fs.write",
      scopePattern: "src/**",
      lifetime: "project",
      projectId: "p1",
    });

    // sibling write now allowed by the project policy; a write elsewhere asks again
    expect(await engine.check(base({ scope: "src/components/X.tsx" }))).toMatchObject({
      decision: "allow",
      source: "policy_project",
    });
    const again = engine.check(base({ scope: "package.json" }));
    expect(requested).toHaveLength(2);
    engine.respond(requested[1]!.id, "deny");
    expect(await again).toEqual({ decision: "deny", source: "user" });
  });

  it("session allows persist for the session, once allows are consumed, deny rules win", async () => {
    const store = memoryStore();
    const requested: contracts.ConsentRequest[] = [];
    const engine = new PermissionEngine({ store, onConsentRequested: (r) => requested.push(r) });
    const p = engine.check(base());
    engine.respond(requested[0]!.id, "allow_session");
    expect(await p).toMatchObject({ decision: "allow", source: "user" });
    expect(await engine.check(base({ scope: "src/other.ts" }))).toMatchObject({
      decision: "allow",
      source: "policy_session",
    });
    expect(store.rows).toHaveLength(0);

    store.insert({
      id: "deny1",
      projectId: "p1",
      capability: "fs.write",
      scopePattern: "src/secret/**",
      decision: "deny",
      lifetime: "project",
      createdAt: 0,
    });
    expect(await engine.check(base({ scope: "src/secret/keys.ts" }))).toMatchObject({
      decision: "deny",
      source: "deny_rule",
      policyId: "deny1",
    });

    engine.revoke(engine.policies("p1").find((x) => x.lifetime === "session")!.id);
    const p2 = engine.check(base({ scope: "src/z.ts" }));
    expect(requested).toHaveLength(2);
    engine.respond(requested[1]!.id, "allow_once");
    expect(await p2).toMatchObject({ decision: "allow", source: "user" });
    const p3 = engine.check(base({ scope: "src/z.ts" }));
    expect(requested).toHaveLength(3);
    engine.respond(requested[2]!.id, "deny");
    await p3;
  });

  it("cancellation and timeouts release parked calls as denials", async () => {
    const resolved: string[] = [];
    const engine = new PermissionEngine({
      store: memoryStore(),
      consentTimeoutMs: 15,
      onConsentResolved: (_id, choice) => resolved.push(choice),
    });
    const ac = new AbortController();
    const p = engine.check(base({ signal: ac.signal }));
    ac.abort();
    expect(await p).toEqual({ decision: "deny", source: "cancelled" });
    expect(await engine.check(base())).toEqual({ decision: "deny", source: "timeout" });
    expect(resolved).toEqual(["cancelled", "timeout"]);
    expect(engine.pending()).toHaveLength(0);
    expect(() => {
      engine.respond("nope", "deny");
    }).toThrow(/no longer pending/);
  });

  it("scopePatternFor widens paths to their directory and keeps other scopes exact", () => {
    expect(scopePatternFor("fs.write", "src/a/b.ts")).toBe("src/a/**");
    expect(scopePatternFor("fs.write", "README.md")).toBe("*");
    expect(scopePatternFor("net.fetch", "api.github.com")).toBe("api.github.com");
    expect(scopePatternFor("shell.exec", "pnpm")).toBe("pnpm");
  });
});
