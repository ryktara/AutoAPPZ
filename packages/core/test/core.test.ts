import { describe, expect, it } from "vitest";
import { ServiceContainer, err, ok } from "../src/index.ts";

describe("ServiceContainer", () => {
  it("lazily constructs singletons and rejects duplicates", () => {
    let built = 0;
    const c = new ServiceContainer<{ a: { n: number } }>();
    c.register("a", () => ({ n: ++built }));
    expect(c.get("a")).toBe(c.get("a"));
    expect(built).toBe(1);
    expect(() => c.register("a", () => ({ n: 0 }))).toThrow(/already registered/);
    expect(() => new ServiceContainer<{ b: number }>().get("b")).toThrow(/not registered/);
  });
  it("Result helpers", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("x")).toEqual({ ok: false, error: "x" });
  });
});
