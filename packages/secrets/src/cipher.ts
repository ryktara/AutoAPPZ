/**
 * Encryption backend for secret values. The desktop app implements this with Electron `safeStorage`
 * (Keychain / DPAPI / libsecret); tests use an in-memory fake. A backend that would store plaintext
 * must report `isAvailable() === false` — the service then refuses to store secrets.
 */
export interface Cipher {
  /** Human-readable backend name for the UI ("keychain", "dpapi", "libsecret", "fake", "none"). */
  readonly backend: string;
  isAvailable(): boolean;
  encrypt(plaintext: string): Uint8Array;
  decrypt(ciphertext: Uint8Array): string;
}

/** Reversible, non-secure cipher for tests only. Never wire this into the app. */
export function createFakeCipher(available = true): Cipher {
  const key = 0x5a;
  return {
    backend: available ? "fake" : "none",
    isAvailable: () => available,
    encrypt(plaintext) {
      const bytes = new TextEncoder().encode(plaintext);
      return bytes.map((b) => b ^ key);
    },
    decrypt(ciphertext) {
      return new TextDecoder().decode(ciphertext.map((b) => b ^ key));
    },
  };
}
