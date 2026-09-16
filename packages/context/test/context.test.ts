import { describe, expect, it } from "vitest";
import type { ContextItem } from "../src/index.ts";

describe("context", () => {
  it("items carry a reason", () => {
    const i: ContextItem = {
      id: "1",
      kind: "file",
      path: "a.ts",
      content: "",
      tokens: 0,
      reason: "matched query",
      score: 1,
    };
    expect(i.reason).toBeTruthy();
  });
});
