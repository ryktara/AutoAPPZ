import { expect, it } from "vitest";
import { add, multiply } from "./math.ts";

it("adds", () => {
  expect(add(2, 3)).toBe(5);
});

it("multiplies", () => {
  expect(multiply(2, 3)).toBe(6);
});
