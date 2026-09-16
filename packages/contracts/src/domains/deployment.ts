import { z } from "zod";
import { defineCommand, defineEvent, defineQuery, defineStream } from "../definitions.ts";
import { ProjectIdSchema } from "../common.ts";

export const DeploymentAdapterIdSchema = z.enum(["vercel", "netlify", "cloudflare", "docker"]);
export type DeploymentAdapterId = z.infer<typeof DeploymentAdapterIdSchema>;

/** A place a project deploys to. `config` is secret-free; credentials and env values are secret ids. */
export const DeploymentTargetSchema = z.object({
  id: z.string().min(1),
  projectId: ProjectIdSchema,
  adapterId: DeploymentAdapterIdSchema,
  name: z.string().min(1).max(80),
  config: z.record(z.string(), z.string()),
  secretId: z.string().min(1).optional(),
  /** Environment variables synced on deploy: name → secret id holding the value. */
  envSecrets: z.record(z.string(), z.string()).default({}),
  updatedAt: z.number().int().nonnegative(),
});
export type DeploymentTarget = z.infer<typeof DeploymentTargetSchema>;

export const ReadinessItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["ok", "warn", "fail"]),
  detail: z.string(),
  fix: z.string().optional(),
});
export type ReadinessItem = z.infer<typeof ReadinessItemSchema>;

export const ReadinessReportSchema = z.object({ items: z.array(ReadinessItemSchema), ready: z.boolean() });
export type ReadinessReport = z.infer<typeof ReadinessReportSchema>;

export const DeploymentStatusSchema = z.enum(["running", "succeeded", "failed", "cancelled"]);

export const DeploymentRecordSchema = z.object({
  id: z.string().min(1),
  targetId: z.string().min(1),
  projectId: ProjectIdSchema,
  adapterId: DeploymentAdapterIdSchema,
  status: DeploymentStatusSchema,
  url: z.string().optional(),
  /** Provider-side id (deployment id, image tag). */
  providerRef: z.string().optional(),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});
export type DeploymentRecord = z.infer<typeof DeploymentRecordSchema>;

export const DeployEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("step"),
    name: z.string(),
    status: z.enum(["started", "done", "failed"]),
    detail: z.string().optional(),
  }),
  z.object({ kind: z.literal("log"), text: z.string() }),
  z.object({
    kind: z.literal("done"),
    url: z.string().optional(),
    providerRef: z.string().optional(),
    hint: z.string().optional(),
  }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type DeployEvent = z.infer<typeof DeployEventSchema>;

export const AdapterDescriptorSchema = z.object({
  id: DeploymentAdapterIdSchema,
  displayName: z.string(),
  mode: z.enum(["source", "prebuilt", "image"]),
  secret: z.object({ kind: z.literal("api-key"), label: z.string(), hint: z.string() }).optional(),
  configFields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      required: z.boolean(),
      placeholder: z.string().optional(),
    }),
  ),
  discoverable: z.boolean(),
});

export const deployAdapters = defineQuery({
  name: "deploy.adapters",
  input: z.void(),
  output: z.array(AdapterDescriptorSchema),
  scope: "deploy",
});

export const deployTargets = defineQuery({
  name: "deploy.targets",
  input: z.object({ projectId: ProjectIdSchema }),
  output: z.array(DeploymentTargetSchema),
  scope: "deploy",
});

export const deployUpsertTarget = defineCommand({
  name: "deploy.upsertTarget",
  input: z.object({
    projectId: ProjectIdSchema,
    id: z.string().min(1).optional(),
    adapterId: DeploymentAdapterIdSchema,
    name: z.string().trim().min(1).max(80),
    config: z.record(z.string(), z.string().max(500)),
    /** Credential stored through `secrets.set`; omit to keep the current one. */
    secretId: z.string().min(1).optional(),
  }),
  output: DeploymentTargetSchema,
  invalidates: ["deploy", "secrets"],
});

export const deployDeleteTarget = defineCommand({
  name: "deploy.deleteTarget",
  input: z.object({ id: z.string().min(1) }),
  output: z.void(),
  invalidates: ["deploy", "secrets"],
});

/** Sets (or clears with no secretId) the value of an environment variable for a target. */
export const deploySetEnv = defineCommand({
  name: "deploy.setEnv",
  input: z.object({
    targetId: z.string().min(1),
    name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    secretId: z.string().min(1).optional(),
  }),
  output: DeploymentTargetSchema,
  invalidates: ["deploy"],
});

export const deployDiscover = defineCommand({
  name: "deploy.discover",
  input: z.object({ adapterId: DeploymentAdapterIdSchema, secretId: z.string().min(1) }),
  output: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      url: z.string().optional(),
      config: z.record(z.string(), z.string()),
    }),
  ),
  invalidates: [],
});

export const deployReadiness = defineQuery({
  name: "deploy.readiness",
  input: z.object({ targetId: z.string().min(1) }),
  output: ReadinessReportSchema.extend({
    framework: z.string(),
    env: z.array(
      z.object({
        name: z.string(),
        required: z.boolean(),
        resolved: z.boolean(),
        source: z.string().optional(),
        description: z.string().optional(),
      }),
    ),
  }),
  scope: "deploy",
});

export const deployRun = defineCommand({
  name: "deploy.run",
  input: z.object({ targetId: z.string().min(1) }),
  output: z.object({ deploymentId: z.string() }),
  invalidates: ["deploy"],
});

export const deployCancel = defineCommand({
  name: "deploy.cancel",
  input: z.object({ deploymentId: z.string().min(1) }),
  output: z.void(),
  invalidates: ["deploy"],
});

export const deployEvents = defineStream({
  name: "deploy.events",
  input: z.object({ deploymentId: z.string().min(1) }),
  chunk: DeployEventSchema,
});

export const deployHistory = defineQuery({
  name: "deploy.history",
  input: z.object({ projectId: ProjectIdSchema, limit: z.number().int().min(1).max(100).default(20) }),
  output: z.array(DeploymentRecordSchema),
  scope: "deploy",
});

export const deployChanged = defineEvent({
  name: "deploy.changed",
  payload: z.object({ projectId: ProjectIdSchema }),
});
