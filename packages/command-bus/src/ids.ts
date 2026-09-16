let counter = 0;

/** Monotonic, process-unique id. Not a secret; used for correlation only. */
export function nextId(prefix: string): string {
  counter += 1;
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0");
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${rand}`;
}

/** Cryptographically random token for subscription capability tokens. */
export function randomToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
