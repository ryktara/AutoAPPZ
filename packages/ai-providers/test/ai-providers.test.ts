import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "../src/index.ts";

describe("ai-providers types", () => {
  it("compile and describe a local model without pricing", () => {
    const m: ModelDescriptor = {
      providerId: "local",
      modelId: "x",
      displayName: "X",
      local: true,
      capabilities: {
        toolCalling: true,
        structuredOutput: false,
        vision: false,
        contextWindow: 8192,
        maxOutputTokens: 1024,
        streaming: true,
      },
    };
    expect(m.pricing).toBeUndefined();
  });
});
