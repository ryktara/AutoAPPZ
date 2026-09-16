import { describe, expect, it } from "vitest";
import type { PermissionDecision } from "../src/index.ts";

describe("permissions", () => {
  it("decision shape", () => {
    const d: PermissionDecision = { granted: false, lifetime: "deny", decidedAt: 0, source: "policy" };
    expect(d.granted).toBe(false);
  });
});
