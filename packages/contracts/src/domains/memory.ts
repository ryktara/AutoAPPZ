import { z } from "zod";
import { defineCommand, defineQuery } from "../definitions.ts";
import { ProjectIdSchema } from "../common.ts";

export const MemoryCategorySchema = z.enum([
  "architecture",
  "conventions",
  "decisions",
  "constraints",
  "glossary",
  "preferences",
  "other",
]);
export type MemoryCategory = z.infer<typeof MemoryCategorySchema>;

/** Distilled project fact with provenance (docs/design/AGENT-ARCHITECTURE.md §7). Never a raw transcript. */
export const ProjectMemoryItemSchema = z.object({
  id: z.string().min(1),
  projectId: ProjectIdSchema,
  category: MemoryCategorySchema,
  statement: z.string().min(1).max(2000),
  provenanceTaskId: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1),
  createdAt: z.number().int().nonnegative(),
  supersededBy: z.string().min(1).optional(),
});
export type ProjectMemoryItem = z.infer<typeof ProjectMemoryItemSchema>;

export const memoryList = defineQuery({
  name: "memory.list",
  input: z.object({ projectId: ProjectIdSchema, includeSuperseded: z.boolean().default(false) }),
  output: z.array(ProjectMemoryItemSchema),
  scope: "memory",
});

export const memoryAdd = defineCommand({
  name: "memory.add",
  input: z.object({
    projectId: ProjectIdSchema,
    category: MemoryCategorySchema,
    statement: z.string().min(1).max(2000),
    confidence: z.number().min(0).max(1).default(1),
    provenanceTaskId: z.string().min(1).optional(),
  }),
  output: ProjectMemoryItemSchema,
  invalidates: ["memory"],
});

/** Replaces a fact with a corrected one; the old item stays for provenance, marked superseded. */
export const memorySupersede = defineCommand({
  name: "memory.supersede",
  input: z.object({
    id: z.string().min(1),
    statement: z.string().min(1).max(2000),
    confidence: z.number().min(0).max(1).default(1),
  }),
  output: ProjectMemoryItemSchema,
  invalidates: ["memory"],
});

export const memoryDelete = defineCommand({
  name: "memory.delete",
  input: z.object({ id: z.string().min(1) }),
  output: z.void(),
  invalidates: ["memory"],
});
