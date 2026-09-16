import { z } from "zod";
import { defineCommand, defineEvent, defineQuery } from "../definitions.ts";
import { ProjectIdSchema, TaskIdSchema } from "../common.ts";

export const CapabilitySchema = z.enum([
  "fs.read",
  "fs.write",
  "fs.delete",
  "shell.exec",
  "net.fetch",
  "git.write",
  "git.remote",
  "db.query",
  "db.mutate",
  "deploy",
  "mcp.call",
  "process.control",
  "secrets.use",
]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const RiskTierSchema = z.enum(["low", "medium", "high", "destructive"]);
export type RiskTier = z.infer<typeof RiskTierSchema>;

export const PolicyDecisionSchema = z.enum(["allow", "deny"]);
export const PolicyLifetimeSchema = z.enum(["once", "session", "project"]);

/** A standing rule: `(projectId?, capability, scopePattern) -> allow|deny` (docs/security/PERMISSIONS.md). */
export const PolicySchema = z.object({
  id: z.string().min(1),
  projectId: ProjectIdSchema.optional(),
  capability: CapabilitySchema,
  /** Glob for paths, host pattern for network, command name for shell, table for db. */
  scopePattern: z.string().min(1),
  decision: PolicyDecisionSchema,
  lifetime: PolicyLifetimeSchema,
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative().optional(),
});
export type Policy = z.infer<typeof PolicySchema>;

export const ConsentChoiceSchema = z.enum(["allow_once", "allow_session", "allow_project", "deny"]);
export type ConsentChoice = z.infer<typeof ConsentChoiceSchema>;

/** A parked tool call waiting for the user. */
export const ConsentRequestSchema = z.object({
  id: z.string().min(1),
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema,
  toolId: z.string().min(1),
  capability: CapabilitySchema,
  scope: z.string().min(1),
  risk: RiskTierSchema,
  /** What will happen, in plain words. */
  description: z.string().min(1),
  /** Optional preview (e.g. a diff) already redacted and bounded. */
  preview: z.string().max(20_000).optional(),
  requestedAt: z.number().int().nonnegative(),
  deadlineAt: z.number().int().nonnegative(),
});
export type ConsentRequest = z.infer<typeof ConsentRequestSchema>;

export const DecisionSourceSchema = z.enum([
  "policy_project",
  "policy_session",
  "policy_once",
  "default",
  "user",
  "timeout",
  "cancelled",
  "deny_rule",
]);
export type DecisionSource = z.infer<typeof DecisionSourceSchema>;

/** Audit row for one tool call (append-only). */
export const ToolCallAuditSchema = z.object({
  id: z.string().min(1),
  taskId: TaskIdSchema,
  agentRunId: z.string().min(1).optional(),
  toolId: z.string().min(1),
  capability: CapabilitySchema,
  scope: z.string().min(1),
  decision: z.enum(["allow", "deny"]),
  decisionSource: DecisionSourceSchema,
  inputRedacted: z.unknown(),
  ok: z.boolean(),
  resultSummary: z.string(),
  durationMs: z.number().int().nonnegative(),
  at: z.number().int().nonnegative(),
});
export type ToolCallAudit = z.infer<typeof ToolCallAuditSchema>;

export const permissionsPolicies = defineQuery({
  name: "permissions.policies",
  input: z.object({ projectId: ProjectIdSchema.optional() }),
  output: z.array(PolicySchema),
  scope: "permissions",
});

export const permissionsRevoke = defineCommand({
  name: "permissions.revoke",
  input: z.object({ id: z.string().min(1) }),
  output: z.void(),
  invalidates: ["permissions"],
});

export const permissionsPending = defineQuery({
  name: "permissions.pending",
  input: z.object({ projectId: ProjectIdSchema.optional() }),
  output: z.array(ConsentRequestSchema),
  scope: "consent",
});

export const permissionsRespond = defineCommand({
  name: "permissions.respond",
  input: z.object({ requestId: z.string().min(1), choice: ConsentChoiceSchema }),
  output: z.void(),
  invalidates: ["consent", "permissions"],
});

export const consentRequested = defineEvent({
  name: "permissions.consentRequested",
  payload: ConsentRequestSchema,
});

export const consentResolved = defineEvent({
  name: "permissions.consentResolved",
  payload: z.object({
    requestId: z.string().min(1),
    choice: ConsentChoiceSchema.or(z.enum(["timeout", "cancelled"])),
  }),
});

export const toolAudit = defineQuery({
  name: "tools.audit",
  input: z.object({ taskId: TaskIdSchema }),
  output: z.array(ToolCallAuditSchema),
  scope: "audit",
});
