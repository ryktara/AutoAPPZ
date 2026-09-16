import { safeStorage } from "electron";
import type { Cipher } from "@autoappz/secrets";

/**
 * Electron safeStorage adapter. On Linux, "basic_text" means no keyring is available and values would be
 * stored obfuscated rather than encrypted; we report that as unavailable so the service refuses to store.
 * Must be created after `app.whenReady()`.
 */
export function createSafeStorageCipher(): Cipher {
  const backend = detectBackend();
  const available = safeStorage.isEncryptionAvailable() && backend !== "basic_text";
  return {
    backend: available ? backend : "none",
    isAvailable: () => available,
    encrypt: (plaintext) => new Uint8Array(safeStorage.encryptString(plaintext)),
    decrypt: (ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext)),
  };
}

function detectBackend(): string {
  if (process.platform === "darwin") return "keychain";
  if (process.platform === "win32") return "dpapi";
  if (process.platform === "linux") return safeStorage.getSelectedStorageBackend();
  return "unknown";
}
