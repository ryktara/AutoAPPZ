import { describe, expect, it } from "vitest";
import type { TemplateDescriptor } from "../src/index.ts";

describe("project types", () => {
  it("bundled template descriptor", () => {
    const t: TemplateDescriptor = {
      id: "react-vite",
      displayName: "React + Vite",
      description: "",
      stack: ["react"],
      source: { kind: "bundled", dir: "react-vite" },
    };
    expect(t.source.kind).toBe("bundled");
  });
});
