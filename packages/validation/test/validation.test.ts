import { describe, expect, it } from "vitest";
import type { ValidationResult } from "../src/index.ts";

describe("validation", () => {
  it("result shape", () => {
    const r: ValidationResult = {
      validator: "tsc",
      ok: true,
      diagnostics: [],
      durationMs: 1,
      truncated: false,
    };
    expect(r.ok).toBe(true);
  });
});
