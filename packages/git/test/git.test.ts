import { describe, expect, it } from "vitest";
import { checkpointBaseRef, withTaskTrailer } from "../src/index.ts";

describe("git helpers", () => {
  it("builds checkpoint refs and rejects unsafe ids", () => {
    expect(checkpointBaseRef("task_1")).toBe("refs/autoappz/checkpoints/task_1/base");
    expect(() => checkpointBaseRef("../x")).toThrow();
    expect(() => checkpointBaseRef("a b")).toThrow();
  });
  it("adds the trailer once", () => {
    const once = withTaskTrailer("feat: x", "t1");
    expect(once).toBe("feat: x\n\nAutoAPPZ-Task: t1\n");
    expect(withTaskTrailer(once, "t1")).toBe(once);
  });
});
