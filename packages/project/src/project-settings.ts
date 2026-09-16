import { project as contracts } from "@autoappz/contracts";
import type { SettingsRepository } from "@autoappz/storage";

type ProjectSettings = contracts.ProjectSettings;
export type ProjectSettingsPatch = { [K in keyof ProjectSettings]?: ProjectSettings[K] | undefined };

const key = (projectId: string) => `project:${projectId}`;

/** Per-project settings stored in the settings key/value table under `project:<id>`. */
export class ProjectSettingsService {
  constructor(private readonly repo: SettingsRepository) {}

  get(projectId: string): ProjectSettings {
    return this.repo.get(key(projectId), contracts.ProjectSettingsSchema);
  }

  update(projectId: string, patch: ProjectSettingsPatch): ProjectSettings {
    const merged: Record<string, unknown> = { ...this.get(projectId) };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) merged[k] = v;
    const next = contracts.ProjectSettingsSchema.parse(merged);
    this.repo.set(key(projectId), next);
    return next;
  }

  /** Removes an optional key (patches skip `undefined`, so clearing needs an explicit call). */
  unset(projectId: string, field: keyof ProjectSettings): ProjectSettings {
    const current = Object.fromEntries(Object.entries(this.get(projectId)).filter(([k]) => k !== field));
    const next = contracts.ProjectSettingsSchema.parse(current);
    this.repo.set(key(projectId), next);
    return next;
  }

  remove(projectId: string): void {
    this.repo.delete(key(projectId));
  }
}
