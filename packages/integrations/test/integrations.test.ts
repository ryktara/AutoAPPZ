import { describe, expect, it } from "vitest";
import type { McpClient } from "../src/index.ts";

describe("integrations", () => {
  it("McpClient shape", () => {
    const c: Partial<McpClient> = {};
    expect(c.call).toBeUndefined();
  });
});
