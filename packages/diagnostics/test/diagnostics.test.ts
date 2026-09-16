import { describe, expect, it } from "vitest";
import { createLoggerRoot, REDACTED, Redactor, RingBufferSink } from "../src/index.ts";

describe("Redactor", () => {
  const r = new Redactor();

  it.each([
    ["sk-abcdefghijklmnopqrstuvwxyz0123", REDACTED],
    ["ghp_abcdefghijklmnopqrstuvwxyz", REDACTED],
    ["AKIAABCDEFGHIJKLMNOP", REDACTED],
    ["Bearer abcdefghijklmnopqrstuvwxyz", `Bearer ${REDACTED}`],
    ["postgres://user:hunter2@host/db", `postgres://${REDACTED}@host/db`],
    ["api_key=supersecretvalue", `api_key=${REDACTED}`],
  ])("redacts pattern %s", (input, expected) => {
    expect(r.redactString(input)).toBe(expected);
  });

  it("leaves ordinary text intact", () => {
    expect(r.redactString("Installing dependencies in project alpha")).toBe(
      "Installing dependencies in project alpha",
    );
  });

  it("redacts registered literal values anywhere", () => {
    const local = new Redactor();
    local.register("my-very-secret");
    expect(local.redactString("error: my-very-secret rejected")).toBe(`error: ${REDACTED} rejected`);
    local.unregister("my-very-secret");
    expect(local.redactString("my-very-secret")).toBe("my-very-secret");
  });

  it("deep-redacts sensitive keys and values in objects", () => {
    const out = r.redact({
      apiKey: "plain-but-sensitive",
      nested: { list: ["ok", "sk-abcdefghijklmnopqrstuvwxyz0123"] },
      n: 1,
    });
    expect(out).toEqual({ apiKey: REDACTED, nested: { list: ["ok", REDACTED] }, n: 1 });
  });

  it("serializes errors with redacted messages", () => {
    const e = new Error("token=abcdefghij failed");
    const out = r.redact(e) as unknown as { message: string };
    expect(out.message).toBe(`token=${REDACTED} failed`);
  });
});

describe("logger", () => {
  it("respects levels, scopes, ids and redacts fields", () => {
    const sink = new RingBufferSink();
    const { logger, redactor, setLevel } = createLoggerRoot({ level: "info", sinks: [sink], now: () => 42 });
    redactor.register("registered-secret");
    logger.debug("hidden");
    const child = logger.child("agent", { sessionId: "s1" }).withIds({ taskId: "t1" });
    child.info("hello registered-secret", { password: "x", other: "registered-secret here" });
    setLevel("debug");
    child.debug("now visible");
    const records = sink.snapshot();
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      ts: 42,
      level: "info",
      scope: "app.agent",
      msg: `hello ${REDACTED}`,
      ids: { sessionId: "s1", taskId: "t1" },
      fields: { password: REDACTED, other: `${REDACTED} here` },
    });
    expect(records[1]!.level).toBe("debug");
  });

  it("survives a throwing sink", () => {
    const { logger } = createLoggerRoot({
      sinks: [
        {
          write() {
            throw new Error("disk full");
          },
        },
      ],
    });
    expect(() => {
      logger.error("x");
    }).not.toThrow();
  });
});
