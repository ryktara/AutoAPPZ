import { createHash } from "node:crypto";

export function contentHash(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 32);
}

/**
 * Per-task record of what the model has read and at which content hash.
 * Writes must reference a read hash (read-before-write) or an explicit `expectedHash`, and the
 * file on disk must still match it (optimistic concurrency) — never a silent overwrite.
 */
export class ReadLedger {
  private readonly hashes = new Map<string, string>();

  recordRead(relativePath: string, hash: string): void {
    this.hashes.set(relativePath, hash);
  }

  lastReadHash(relativePath: string): string | undefined {
    return this.hashes.get(relativePath);
  }

  forget(relativePath: string): void {
    this.hashes.delete(relativePath);
  }
}
