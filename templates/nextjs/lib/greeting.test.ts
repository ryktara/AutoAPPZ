import { expect, it } from "vitest";
import { greeting } from "./greeting";

it("greets by name and falls back when empty", () => {
  expect(greeting("builder")).toBe("Hello, builder!");
  expect(greeting("   ")).toBe("Hello!");
});
