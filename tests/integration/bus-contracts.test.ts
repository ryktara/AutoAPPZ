import { describe, expect, it } from "vitest";
import { ALL_CONTRACTS } from "@autoappz/contracts";
import { CommandBusHost } from "@autoappz/command-bus";

describe("contract registry vs bus", () => {
  it("every command/query/stream is reported until handled", () => {
    const host = new CommandBusHost({ contracts: ALL_CONTRACTS });
    const expected = ALL_CONTRACTS.filter((c) => c.kind !== "event").map((c) => c.name);
    expect(host.unhandledContracts().sort()).toEqual([...expected].sort());
  });
});
