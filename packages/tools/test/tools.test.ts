import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolDefinition } from "../src/index.ts";

describe("tools types", () => {
  it("describe a read tool", () => {
    const t: ToolDefinition = {
      name: "fs.read",
      description: "read",
      input: z.object({}),
      output: z.string(),
      risk: "read",
      capability: "fs.read",
    };
    expect(t.risk).toBe("read");
  });
});
