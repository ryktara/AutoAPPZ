import { describe, expect, it } from "vitest";
import { PluginManifestSchema } from "../src/index.ts";

describe("PluginManifestSchema", () => {
  it("accepts a valid manifest and rejects bad ids/capabilities", () => {
    const ok = PluginManifestSchema.safeParse({
      id: "my-plugin",
      version: "1.0.0",
      displayName: "X",
      entry: "index.js",
      capabilities: ["tools.register"],
      minHostVersion: "0.1.0",
    });
    expect(ok.success).toBe(true);
    expect(
      PluginManifestSchema.safeParse({
        id: "My Plugin",
        version: "1",
        displayName: "X",
        entry: "i",
        capabilities: ["nope"],
        minHostVersion: "0.1.0",
      }).success,
    ).toBe(false);
  });
});
