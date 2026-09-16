import { z } from "zod";
import { defineCommand, defineQuery } from "../definitions.ts";
import { ProjectIdSchema } from "../common.ts";

/**
 * Blueprint: the product specification the agent plans against and the reviewer verifies
 * (docs/design/AGENT-ARCHITECTURE.md §6). Persisted per project with versions.
 */
const Id = z.string().min(1).max(64);

export const BlueprintPageSchema = z.object({
  id: Id,
  title: z.string().min(1).max(120),
  path: z.string().min(1).max(200),
  purpose: z.string().max(1000).default(""),
  roles: z.array(Id).default([]),
});

export const BlueprintFieldSchema = z.object({
  name: Id,
  type: z.string().min(1).max(60),
  required: z.boolean().default(true),
  notes: z.string().max(500).optional(),
});

export const BlueprintEntitySchema = z.object({
  name: Id,
  description: z.string().max(1000).default(""),
  fields: z.array(BlueprintFieldSchema).default([]),
  relations: z.array(z.object({ to: Id, kind: z.enum(["one", "many"]), name: Id.optional() })).default([]),
});

export const AcceptanceCriterionSpecSchema = z.object({
  id: Id,
  text: z.string().min(1).max(1000),
  /** Page or entity id this criterion belongs to; unassigned criteria group under "general". */
  ref: Id.optional(),
});

export const BlueprintDocumentSchema = z.object({
  product: z.object({
    name: z.string().min(1).max(120),
    summary: z.string().max(2000).default(""),
    goals: z.array(z.string().max(500)).default([]),
  }),
  users: z.array(z.object({ id: Id, description: z.string().max(500).default("") })).default([]),
  roles: z.array(z.object({ id: Id, description: z.string().max(500).default("") })).default([]),
  pages: z.array(BlueprintPageSchema).default([]),
  navigation: z.array(z.object({ label: z.string().min(1).max(80), pageId: Id })).default([]),
  entities: z.array(BlueprintEntitySchema).default([]),
  database: z
    .object({ kind: z.string().max(60).default("none"), notes: z.string().max(1000).default("") })
    .prefault({}),
  authentication: z
    .object({
      strategy: z.string().max(60).default("none"),
      providers: z.array(z.string().max(60)).default([]),
    })
    .prefault({}),
  integrations: z
    .array(z.object({ kind: z.string().max(60), notes: z.string().max(500).default("") }))
    .default([]),
  api: z
    .array(
      z.object({
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        path: z.string().min(1).max(200),
        purpose: z.string().max(500).default(""),
      }),
    )
    .default([]),
  design_system: z
    .object({ theme: z.string().max(60).default("default"), notes: z.string().max(1000).default("") })
    .prefault({}),
  deployment: z
    .object({ target: z.string().max(60).default("none"), notes: z.string().max(1000).default("") })
    .prefault({}),
  tests: z.object({ strategy: z.string().max(1000).default("") }).prefault({}),
  acceptance_criteria: z.array(AcceptanceCriterionSpecSchema).default([]),
});
export type BlueprintDocument = z.infer<typeof BlueprintDocumentSchema>;

export const BlueprintSchema = z.object({
  id: z.string().min(1),
  projectId: ProjectIdSchema,
  version: z.number().int().positive(),
  document: BlueprintDocumentSchema,
  approvedAt: z.number().int().nonnegative().optional(),
  derivedFromTaskId: z.string().min(1).optional(),
});
export type Blueprint = z.infer<typeof BlueprintSchema>;

export const blueprintGet = defineQuery({
  name: "blueprint.get",
  input: z.object({ projectId: ProjectIdSchema }),
  output: BlueprintSchema.nullable(),
  scope: "blueprint",
});

export const blueprintSave = defineCommand({
  name: "blueprint.save",
  input: z.object({
    projectId: ProjectIdSchema,
    document: BlueprintDocumentSchema,
    derivedFromTaskId: z.string().min(1).optional(),
  }),
  output: BlueprintSchema,
  invalidates: ["blueprint"],
});

export const blueprintApprove = defineCommand({
  name: "blueprint.approve",
  input: z.object({ projectId: ProjectIdSchema, version: z.number().int().positive() }),
  output: BlueprintSchema,
  invalidates: ["blueprint"],
});

export const RequirementStatusSchema = z.enum(["planned", "in_progress", "met", "unmet", "unknown"]);

export const RequirementSchema = z.object({
  id: z.string().min(1), // REQ-001
  projectId: ProjectIdSchema,
  blueprintItemRef: z.string().min(1).optional(),
  title: z.string().min(1),
  status: RequirementStatusSchema,
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const AcceptanceCriterionSchema = z.object({
  id: z.string().min(1), // AC-001
  requirementId: z.string().min(1),
  text: z.string().min(1),
  status: RequirementStatusSchema,
  evidence: z.record(z.string(), z.unknown()).optional(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const requirementsList = defineQuery({
  name: "requirements.list",
  input: z.object({ projectId: ProjectIdSchema }),
  output: z.object({
    requirements: z.array(RequirementSchema),
    criteria: z.array(AcceptanceCriterionSchema),
  }),
  scope: "requirements",
});

/** Derives REQ/AC rows from the latest blueprint, preserving statuses of rows that still exist. */
export const requirementsSync = defineCommand({
  name: "requirements.sync",
  input: z.object({ projectId: ProjectIdSchema }),
  output: z.object({
    requirements: z.array(RequirementSchema),
    criteria: z.array(AcceptanceCriterionSchema),
  }),
  invalidates: ["requirements"],
});
