import { z } from "zod";
import { defineCommand, defineEvent, defineQuery } from "../definitions.ts";
import { SecretRefSchema } from "../common.ts";

export const ThemePreferenceSchema = z.enum(["system", "light", "dark"]);

export const UserSettingsSchema = z.object({
  theme: ThemePreferenceSchema.default("system"),
  telemetryConsent: z.enum(["unset", "opted_in", "opted_out"]).default("unset"),
  projectsDirectory: z.string().min(1).optional(),
  defaultTemplateId: z.string().min(1).default("react-vite"),
  autoApprovePlansBelowComplexity: z.enum(["none", "trivial", "standard"]).default("trivial"),
  reducedMotion: z.boolean().default(false),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

export const settingsGet = defineQuery({
  name: "settings.get",
  input: z.void(),
  output: UserSettingsSchema,
  scope: "settings",
});

export const settingsUpdate = defineCommand({
  name: "settings.update",
  input: UserSettingsSchema.partial(),
  output: UserSettingsSchema,
  invalidates: ["settings"],
});

export const settingsChanged = defineEvent({
  name: "settings.changed",
  payload: UserSettingsSchema,
});

/** Secrets are written by value once and referenced afterwards. */
export const secretsSet = defineCommand({
  name: "secrets.set",
  input: z.object({
    kind: SecretRefSchema.shape.kind,
    label: z.string().min(1).max(120),
    value: z.string().min(1).max(16_384),
    replaceId: z.string().min(1).optional(),
  }),
  output: SecretRefSchema,
  invalidates: ["secrets"],
});

export const secretsList = defineQuery({
  name: "secrets.list",
  input: z.void(),
  output: z.array(SecretRefSchema),
  scope: "secrets",
});

export const secretsDelete = defineCommand({
  name: "secrets.delete",
  input: z.object({ id: z.string().min(1) }),
  output: z.void(),
  invalidates: ["secrets"],
});
