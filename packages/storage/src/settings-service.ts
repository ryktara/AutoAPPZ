import { settings as settingsContracts } from "@autoappz/contracts";
import type { SettingsRepository } from "./repositories/settings.ts";

type UserSettings = settingsContracts.UserSettings;
/** Partial where explicit `undefined` means "leave unchanged" (matches the zod .partial() input). */
export type UserSettingsPatch = { [K in keyof UserSettings]?: UserSettings[K] | undefined };

const USER_SETTINGS_KEY = "user";

/** Validated user settings on top of the key/value repository. */
export class SettingsService {
  private readonly listeners = new Set<(next: UserSettings) => void>();

  constructor(private readonly repo: SettingsRepository) {}

  get(): UserSettings {
    return this.repo.get(USER_SETTINGS_KEY, settingsContracts.UserSettingsSchema);
  }

  update(patch: UserSettingsPatch): UserSettings {
    const next = settingsContracts.UserSettingsSchema.parse({ ...this.get(), ...stripUndefined(patch) });
    this.repo.set(USER_SETTINGS_KEY, next);
    for (const l of this.listeners) l(next);
    return next;
  }

  onChange(listener: (next: UserSettings) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}
