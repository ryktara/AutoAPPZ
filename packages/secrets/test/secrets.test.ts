import { describe, expect, it } from "vitest";
import type { SecretStore } from "../src/index.ts";

describe("secrets", () => {
  it("interface shape", () => {
    const store: Partial<SecretStore> = {};
    expect(store.resolve).toBeUndefined();
  });
});
