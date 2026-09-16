import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ALL_CONTRACTS,
  AppError,
  FORBIDDEN_SECRET_FIELD_NAMES,
  ProjectRelativePathSchema,
  SerializedAppErrorSchema,
  WireMessageSchema,
  contractNames,
  defineCommand,
  defineEvent,
} from "../src/index.ts";

describe("definitions", () => {
  it("rejects invalid contract names", () => {
    expect(() => defineCommand({ name: "Create", input: z.void(), output: z.void() })).toThrow(
      /Invalid contract name/,
    );
    expect(() => defineEvent({ name: "project", payload: z.void() })).toThrow(/Invalid contract name/);
  });

  it("defaults invalidates to an empty list", () => {
    const c = defineCommand({ name: "a.b", input: z.void(), output: z.void() });
    expect(c.invalidates).toEqual([]);
    expect(c.kind).toBe("command");
  });
});

describe("registry", () => {
  it("has unique names and known kinds", () => {
    const names = contractNames();
    expect(new Set(names).size).toBe(names.length);
    for (const c of ALL_CONTRACTS) expect(["command", "query", "event", "stream"]).toContain(c.kind);
  });

  it("never declares raw secret fields (secret values must be SecretRef)", () => {
    for (const c of ALL_CONTRACTS) {
      const schemas = "input" in c ? [c.input] : [];
      if ("output" in c) schemas.push(c.output);
      if ("payload" in c) schemas.push(c.payload);
      for (const schema of schemas) {
        const shape = (schema as { shape?: Record<string, unknown> }).shape;
        if (!shape) continue;
        for (const key of Object.keys(shape)) {
          // `secrets.set` is the single allowed write path and names its field `value` on purpose.
          expect(FORBIDDEN_SECRET_FIELD_NAMES as readonly string[]).not.toContain(key);
        }
      }
    }
  });
});

describe("AppError", () => {
  it("serializes and deserializes losslessly", () => {
    const err = new AppError("conflict", "project.name_taken", "Name already used", {
      details: { name: "x" },
      correlationId: "c1",
    });
    const json = err.toJSON();
    expect(SerializedAppErrorSchema.parse(json)).toEqual(json);
    const back = AppError.fromSerialized(json);
    expect(back.kind).toBe("conflict");
    expect(back.retryable).toBe(false);
    expect(back.details).toEqual({ name: "x" });
  });

  it("marks timeouts/external as retryable by default", () => {
    expect(new AppError("timeout", "t", "m").retryable).toBe(true);
    expect(new AppError("validation", "v", "m").retryable).toBe(false);
  });

  it("converts AbortError to cancelled", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(AppError.from(abort).kind).toBe("cancelled");
    expect(AppError.from("boom").kind).toBe("internal");
  });
});

describe("ProjectRelativePathSchema", () => {
  it.each(["src/index.ts", "a/b/c.txt", "README.md"])("accepts %s", (p) => {
    expect(ProjectRelativePathSchema.safeParse(p).success).toBe(true);
  });
  it.each(["/etc/passwd", "C:\\x", "\\\\server\\share", "~/x", "../x", "a/../../b"])("rejects %s", (p) => {
    expect(ProjectRelativePathSchema.safeParse(p).success).toBe(false);
  });
});

describe("WireMessageSchema", () => {
  it("parses each message type and rejects unknown", () => {
    const ok = WireMessageSchema.safeParse({
      type: "request",
      request: { id: "1", name: "settings.get", ids: { sessionId: "s" }, issuedAt: 1, input: undefined },
    });
    expect(ok.success).toBe(true);
    expect(WireMessageSchema.safeParse({ type: "nope" }).success).toBe(false);
  });
});
