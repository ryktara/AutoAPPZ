import { z } from "zod";
import { defineCommand, defineEvent, defineQuery } from "../definitions.ts";
import { ProjectIdSchema } from "../common.ts";

export const IndexStatusSchema = z.object({
  state: z.enum(["idle", "indexing", "ready", "error"]),
  files: z.number().int().nonnegative(),
  indexed: z.number().int().nonnegative(),
  lastFullAt: z.number().int().nonnegative().optional(),
  lastIncrementalAt: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});
export type IndexStatus = z.infer<typeof IndexStatusSchema>;

/** One retrieved excerpt with the reasons it was selected; shown in the "why included" UI. */
export const ContextItemSummarySchema = z.object({
  path: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  kind: z.enum(["chunk", "outline"]),
  tokens: z.number().int().nonnegative(),
  reasons: z.array(z.string()),
});
export type ContextItemSummary = z.infer<typeof ContextItemSummarySchema>;

export const contextStatus = defineQuery({
  name: "context.status",
  input: z.object({ projectId: ProjectIdSchema }),
  output: IndexStatusSchema,
  scope: "context",
});

export const contextReindex = defineCommand({
  name: "context.reindex",
  input: z.object({ projectId: ProjectIdSchema }),
  output: IndexStatusSchema,
  invalidates: ["context"],
});

export const contextSearch = defineQuery({
  name: "context.search",
  input: z.object({
    projectId: ProjectIdSchema,
    query: z.string().min(1).max(500),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  output: z.array(
    z.object({
      path: z.string(),
      startLine: z.number().int(),
      endLine: z.number().int(),
      kind: z.string(),
      score: z.number(),
      snippet: z.string(),
    }),
  ),
  scope: "context",
});

export const contextStatusChanged = defineEvent({
  name: "context.statusChanged",
  payload: z.object({ projectId: ProjectIdSchema, status: IndexStatusSchema }),
});
