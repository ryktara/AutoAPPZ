import type { SecretRef } from "@autoappz/contracts";

/**
 * Secret values are stored encrypted (OS keychain / safe storage) and are only ever
 * resolved inside the main process at the moment of use. Nothing returns them to the renderer.
 */
export interface SecretStore {
  set(input: {
    kind: SecretRef["kind"];
    label: string;
    value: string;
    replaceId?: string;
  }): Promise<SecretRef>;
  list(): Promise<readonly SecretRef[]>;
  delete(id: string): Promise<void>;
  /** Main-process only. Callers must register the value with the Redactor before use. */
  resolve(ref: Pick<SecretRef, "id">): Promise<string | undefined>;
}
