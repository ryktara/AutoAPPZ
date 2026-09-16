import { describe, expect, it } from "vitest";
import { PLATFORM_DB_FILENAME } from "../src/index.ts";

describe("storage", () => {
  it("names the platform db", () => {
    expect(PLATFORM_DB_FILENAME).toBe("autoappz.db");
  });
});
