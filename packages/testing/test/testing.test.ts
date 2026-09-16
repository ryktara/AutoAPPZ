import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { FakeClock, collect, withTempDir } from "../src/index.ts";

describe("testing utils", () => {
  it("fake clock advances", () => {
    const c = new FakeClock(0);
    c.advance(5);
    expect(c.now()).toBe(5);
  });
  it("collects async iterables", async () => {
    async function* gen() {
      await Promise.resolve();
      yield 1;
      yield 2;
    }
    expect(await collect(gen())).toEqual([1, 2]);
  });
  it("temp dir is removed", async () => {
    const dir = await withTempDir((d) => Promise.resolve(d));
    expect(existsSync(dir)).toBe(false);
  });
});
