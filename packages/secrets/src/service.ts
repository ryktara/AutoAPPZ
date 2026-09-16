import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AppError, type SecretKind, type SecretRef } from "@autoappz/contracts";
import type { Logger, Redactor } from "@autoappz/diagnostics";
import type { SecretRefsRepository } from "@autoappz/storage";
import type { Cipher } from "./cipher.ts";

export interface SecretStoreSetInput {
  kind: SecretKind;
  label: string;
  value: string;
  provider?: string | undefined;
  replaceId?: string | undefined;
}

/** Main-process-only API. Values never leave this process; contracts carry SecretRef. */
export interface SecretStore {
  set(input: SecretStoreSetInput): Promise<SecretRef>;
  list(): Promise<readonly SecretRef[]>;
  delete(id: string): Promise<void>;
  /** Resolve a value for immediate use. Registers it with the redactor first. */
  resolve(ref: Pick<SecretRef, "id">): Promise<string | undefined>;
  storageStatus(): { available: boolean; backend: string };
}

export interface SecretServiceOptions {
  refs: SecretRefsRepository;
  cipher: Cipher;
  /** Directory holding one ciphertext file per secret (`<id>.bin`). Created on demand. */
  vaultDir: string;
  redactor: Redactor;
  logger?: Logger | undefined;
  now?: (() => number) | undefined;
  newId?: (() => string) | undefined;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export class SecretService implements SecretStore {
  private readonly refs: SecretRefsRepository;
  private readonly cipher: Cipher;
  private readonly vaultDir: string;
  private readonly redactor: Redactor;
  private readonly log: Logger | undefined;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: SecretServiceOptions) {
    this.refs = options.refs;
    this.cipher = options.cipher;
    this.vaultDir = options.vaultDir;
    this.redactor = options.redactor;
    this.log = options.logger;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? defaultId;
  }

  storageStatus(): { available: boolean; backend: string } {
    return { available: this.cipher.isAvailable(), backend: this.cipher.backend };
  }

  /* Public methods return promises even for synchronous work so callers always get rejections, never throws. */

  set(input: SecretStoreSetInput): Promise<SecretRef> {
    return Promise.resolve().then(() => this.setSync(input));
  }

  list(): Promise<readonly SecretRef[]> {
    return Promise.resolve().then(() => this.refs.list());
  }

  delete(id: string): Promise<void> {
    return Promise.resolve().then(() => {
      this.deleteSync(id);
    });
  }

  resolve(ref: Pick<SecretRef, "id">): Promise<string | undefined> {
    return Promise.resolve().then(() => this.resolveSync(ref));
  }

  private setSync(input: SecretStoreSetInput): SecretRef {
    if (!this.cipher.isAvailable()) {
      throw new AppError(
        "precondition",
        "secrets.no_secure_storage",
        "No secure storage is available on this machine, so secrets cannot be saved.",
        { details: { backend: this.cipher.backend } },
      );
    }
    // Register before anything else so even a failure path cannot log the value.
    this.redactor.register(input.value);

    const at = this.now();
    let ref: SecretRef;
    if (input.replaceId !== undefined) {
      const existing = this.refs.get(input.replaceId);
      if (!existing) {
        throw new AppError("not_found", "secrets.not_found", "The secret to rotate does not exist.", {
          details: { id: input.replaceId },
        });
      }
      ref = { ...existing, kind: input.kind, label: input.label, rotatedAt: at };
      if (input.provider !== undefined) ref.provider = input.provider;
      else delete ref.provider;
      const lastFour = lastFourOf(input.value);
      if (lastFour !== undefined) ref.lastFour = lastFour;
      else delete ref.lastFour;
      this.writeCiphertext(ref.id, input.value);
      this.refs.update(ref);
      this.log?.info("secret rotated", { id: ref.id, kind: ref.kind });
    } else {
      const id = this.newId();
      if (!ID_PATTERN.test(id)) throw new Error("Generated secret id is not filesystem-safe");
      ref = { id, kind: input.kind, label: input.label, createdAt: at };
      if (input.provider !== undefined) ref.provider = input.provider;
      const lastFour = lastFourOf(input.value);
      if (lastFour !== undefined) ref.lastFour = lastFour;
      this.writeCiphertext(id, input.value);
      this.refs.insert(ref);
      this.log?.info("secret stored", { id: ref.id, kind: ref.kind });
    }
    return ref;
  }

  private deleteSync(id: string): void {
    assertId(id);
    const removed = this.refs.delete(id);
    rmSync(this.filePath(id), { force: true });
    if (!removed) {
      throw new AppError("not_found", "secrets.not_found", "The secret does not exist.", { details: { id } });
    }
    this.log?.info("secret deleted", { id });
  }

  private resolveSync(ref: Pick<SecretRef, "id">): string | undefined {
    assertId(ref.id);
    if (!this.refs.get(ref.id)) return undefined;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(this.filePath(ref.id)));
    } catch {
      this.log?.warn("secret ciphertext missing", { id: ref.id });
      return undefined;
    }
    const value = this.cipher.decrypt(bytes);
    this.redactor.register(value);
    return value;
  }

  private filePath(id: string): string {
    return path.join(this.vaultDir, `${id}.bin`);
  }

  private writeCiphertext(id: string, value: string): void {
    mkdirSync(this.vaultDir, { recursive: true, mode: 0o700 });
    const target = this.filePath(id);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, this.cipher.encrypt(value), { mode: 0o600 });
    renameSync(tmp, target);
  }
}

function assertId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new AppError("validation", "secrets.invalid_id", "Invalid secret id.", { details: { id } });
  }
}

/** Only reveal a suffix when the value is long enough that it cannot help reconstruct it. */
function lastFourOf(value: string): string | undefined {
  return value.length >= 12 ? value.slice(-4) : undefined;
}

function defaultId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let out = "sec_";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
