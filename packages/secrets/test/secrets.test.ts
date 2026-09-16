import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "@autoappz/contracts";
import { Redactor, createLoggerRoot, RingBufferSink } from "@autoappz/diagnostics";
import { SecretRefsRepository, openDatabase } from "@autoappz/storage";
import { withTempDir } from "@autoappz/testing";
import { SecretService, createFakeCipher } from "../src/index.ts";

const VALUE = "sk-fixture-secret-value-1234567890";

function setup(dir: string, available = true) {
  const h = openDatabase({ path: ":memory:" });
  const sink = new RingBufferSink();
  const redactor = new Redactor();
  const { logger } = createLoggerRoot({ sinks: [sink], redactor, level: "debug" });
  let n = 0;
  const service = new SecretService({
    refs: new SecretRefsRepository(h.db),
    cipher: createFakeCipher(available),
    vaultDir: path.join(dir, "vault"),
    redactor,
    logger,
    now: () => 1000,
    newId: () => `sec_test_${String(++n).padStart(4, "0")}`,
  });
  return { service, sink, redactor, close: () => h.close() };
}

describe("SecretService", () => {
  it("stores, lists, resolves and deletes without persisting plaintext", async () => {
    await withTempDir(async (dir) => {
      const { service, sink, close } = setup(dir);
      const ref = await service.set({ kind: "api-key", label: "OpenAI", value: VALUE, provider: "openai" });
      expect(ref).toEqual({
        id: "sec_test_0001",
        kind: "api-key",
        label: "OpenAI",
        provider: "openai",
        lastFour: "7890",
        createdAt: 1000,
      });
      expect(await service.list()).toEqual([ref]);
      expect(await service.resolve(ref)).toBe(VALUE);

      const files = readdirSync(path.join(dir, "vault"));
      expect(files).toEqual(["sec_test_0001.bin"]);
      expect(readFileSync(path.join(dir, "vault", files[0]!), "utf8")).not.toContain("fixture");
      expect(JSON.stringify(sink.snapshot())).not.toContain(VALUE);

      await service.delete(ref.id);
      expect(await service.list()).toEqual([]);
      expect(readdirSync(path.join(dir, "vault"))).toEqual([]);
      await expect(service.delete(ref.id)).rejects.toMatchObject({ kind: "not_found" });
      close();
    });
  });

  it("omits lastFour for short values", async () => {
    await withTempDir(async (dir) => {
      const { service, close } = setup(dir);
      const ref = await service.set({ kind: "password", label: "short", value: "hunter2" });
      expect(ref.lastFour).toBeUndefined();
      close();
    });
  });

  it("rotates in place keeping the id", async () => {
    await withTempDir(async (dir) => {
      const { service, close } = setup(dir);
      const ref = await service.set({ kind: "api-key", label: "A", value: VALUE });
      const rotated = await service.set({
        kind: "api-key",
        label: "A2",
        value: "new-value-abcdefghijkl",
        replaceId: ref.id,
      });
      expect(rotated.id).toBe(ref.id);
      expect(rotated.rotatedAt).toBe(1000);
      expect(rotated.lastFour).toBe("ijkl");
      expect(await service.resolve(ref)).toBe("new-value-abcdefghijkl");
      await expect(
        service.set({ kind: "api-key", label: "x", value: "y", replaceId: "sec_missing_1" }),
      ).rejects.toMatchObject({ kind: "not_found" });
      close();
    });
  });

  it("refuses to store when secure storage is unavailable", async () => {
    await withTempDir(async (dir) => {
      const { service, close } = setup(dir, false);
      expect(service.storageStatus()).toEqual({ available: false, backend: "none" });
      await expect(service.set({ kind: "api-key", label: "A", value: VALUE })).rejects.toBeInstanceOf(
        AppError,
      );
      await expect(service.set({ kind: "api-key", label: "A", value: VALUE })).rejects.toMatchObject({
        code: "secrets.no_secure_storage",
      });
      close();
    });
  });

  it("registers values with the redactor so logs cannot contain them", async () => {
    await withTempDir(async (dir) => {
      const { service, redactor, close } = setup(dir);
      await service.set({ kind: "api-key", label: "A", value: VALUE });
      expect(redactor.redactString(`error: ${VALUE} rejected`)).toBe("error: [REDACTED] rejected");
      close();
    });
  });

  it("rejects unsafe ids", async () => {
    await withTempDir(async (dir) => {
      const { service, close } = setup(dir);
      await expect(service.delete("../etc")).rejects.toMatchObject({ code: "secrets.invalid_id" });
      await expect(service.resolve({ id: "a/b" })).rejects.toMatchObject({ code: "secrets.invalid_id" });
      close();
    });
  });
});
