import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, defineQuery, type AnyQuery, type InputOf, type OutputOf } from "@autoappz/contracts";
import { QueryCache } from "../src/renderer/state/query-cache.ts";

const q = defineQuery({
  name: "t.value",
  input: z.object({ k: z.string() }),
  output: z.number(),
  scope: "t",
});
const other = defineQuery({ name: "u.value", input: z.void(), output: z.number(), scope: "u" });

function dispatcher(values: Record<string, number | Error>) {
  const calls: string[] = [];
  return {
    calls,
    values,
    dispatch<D extends AnyQuery>(def: D, input: InputOf<D>): Promise<OutputOf<D>> {
      const key = `${def.name}:${JSON.stringify(input ?? null)}`;
      calls.push(key);
      const v = values[key];
      if (v instanceof Error) return Promise.reject(v);
      return Promise.resolve(v as OutputOf<D>);
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("QueryCache", () => {
  it("fetches once per key, notifies subscribers and exposes data", async () => {
    const d = dispatcher({ 't.value:{"k":"a"}': 1 });
    const cache = new QueryCache(d);
    let notified = 0;
    cache.subscribe(q, { k: "a" }, () => notified++);
    expect(cache.read(q, { k: "a" }).status).toBe("loading");
    expect(cache.read(q, { k: "a" }).status).toBe("loading"); // no second fetch
    await tick();
    expect(cache.read(q, { k: "a" })).toMatchObject({ status: "success", data: 1 });
    expect(d.calls).toEqual(['t.value:{"k":"a"}']);
    expect(notified).toBe(1);
  });

  it("surfaces errors while keeping previous data", async () => {
    const d = dispatcher({ "u.value:null": 5 });
    const cache = new QueryCache(d);
    cache.read(other, undefined);
    await tick();
    d.values["u.value:null"] = new AppError("external", "x", "boom");
    cache.invalidate(["u"]);
    await tick();
    const e = cache.read(other, undefined);
    expect(e.status).toBe("error");
    expect(e.data).toBe(5);
    expect(e.error?.code).toBe("x");
  });

  it("invalidates only matching scopes", async () => {
    const d = dispatcher({ 't.value:{"k":"a"}': 1, "u.value:null": 2 });
    const cache = new QueryCache(d);
    cache.read(q, { k: "a" });
    cache.read(other, undefined);
    await tick();
    cache.invalidate(["t"]);
    await tick();
    expect(d.calls).toEqual(['t.value:{"k":"a"}', "u.value:null", 't.value:{"k":"a"}']);
  });
});
