import { z } from "zod";

export const SecretKindSchema = z.enum(["api-key", "oauth-token", "password", "connection-string", "other"]);
export type SecretKind = z.infer<typeof SecretKindSchema>;

/** A reference to a secret stored by the secrets service. Secret values never cross the bus. */
export const SecretRefSchema = z.object({
  id: z.string().min(1),
  kind: SecretKindSchema,
  /** Optional owner, e.g. a model provider id ("openai") or integration id. */
  provider: z.string().min(1).max(64).optional(),
  label: z.string().min(1).max(120),
  /** Last four characters, only kept for values long enough that this reveals nothing (≥ 12 chars). */
  lastFour: z.string().max(4).optional(),
  createdAt: z.number().int().nonnegative(),
  rotatedAt: z.number().int().nonnegative().optional(),
});
export type SecretRef = z.infer<typeof SecretRefSchema>;

/** Names of fields that must never carry raw secret values in any contract. */
export const FORBIDDEN_SECRET_FIELD_NAMES = [
  "apiKey",
  "token",
  "secret",
  "password",
  "accessToken",
  "refreshToken",
] as const;

export const ProjectIdSchema = z.string().min(1);
export const TaskIdSchema = z.string().min(1);
export const SessionIdSchema = z.string().min(1);

/** Relative, forward-slash, project-root-relative path. Absolute paths are rejected at the contract level. */
export const ProjectRelativePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (p) => !p.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(p) && !p.startsWith("\\\\") && !p.startsWith("~"),
    {
      message: "Path must be relative to the project root.",
    },
  )
  .refine((p) => !p.split(/[\\/]/).includes(".."), { message: "Path must not contain '..' segments." });
export type ProjectRelativePath = z.infer<typeof ProjectRelativePathSchema>;

export const TokenBudgetSchema = z.object({
  total: z.number().int().positive(),
  perSource: z.record(z.string(), z.number().int().nonnegative()).optional(),
});
export type TokenBudget = z.infer<typeof TokenBudgetSchema>;
