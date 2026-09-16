import { describe, expect, it } from "vitest";
import { TASK_STATES, isTerminal } from "../src/index.ts";

describe("task states", () => {
  it("are unique and only COMPLETE/CANCELLED are terminal", () => {
    expect(new Set(TASK_STATES).size).toBe(TASK_STATES.length);
    expect(TASK_STATES.filter(isTerminal)).toEqual(["COMPLETE", "CANCELLED"]);
  });
});
