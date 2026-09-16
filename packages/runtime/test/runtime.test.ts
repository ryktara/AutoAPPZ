import { describe, expect, it } from "vitest";
import { PHASE_TIMEOUTS_MS, PORT_RANGES } from "../src/index.ts";

describe("runtime constants", () => {
  it("port ranges do not overlap", () => {
    expect(PORT_RANGES.app.to).toBeLessThan(PORT_RANGES.preview.from);
  });
  it("timeouts are positive", () => {
    for (const v of Object.values(PHASE_TIMEOUTS_MS)) expect(v).toBeGreaterThan(0);
  });
});
