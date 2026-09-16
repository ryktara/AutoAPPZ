import { z } from "zod";
import { defineCommand, defineEvent, defineQuery } from "../definitions.ts";
import { ProjectIdSchema } from "../common.ts";

export const ProjectOriginSchema = z.enum(["created", "imported", "copied"]);
export type ProjectOrigin = z.infer<typeof ProjectOriginSchema>;

export const RuntimeProfileSchema = z.enum(["host", "container"]);
export type RuntimeProfile = z.infer<typeof RuntimeProfileSchema>;

export const ProjectSchema = z.object({
  id: ProjectIdSchema,
  name: z.string().min(1).max(80),
  /** Absolute path on this machine. Never inside the app data directory. */
  path: z.string().min(1),
  origin: ProjectOriginSchema,
  templateId: z.string().min(1).optional(),
  runtimeProfile: RuntimeProfileSchema,
  createdAt: z.number().int().nonnegative(),
  lastOpenedAt: z.number().int().nonnegative(),
  archivedAt: z.number().int().nonnegative().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** Commands are argument arrays; never shell strings. */
export const RuntimeCommandSchema = z.array(z.string().min(1)).min(1);

export const TemplateSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  displayName: z.string().min(1).max(80),
  description: z.string().max(500),
  stack: z.array(z.string().min(1)),
  runtime: z.object({
    install: RuntimeCommandSchema,
    dev: RuntimeCommandSchema,
    build: RuntimeCommandSchema,
    test: RuntimeCommandSchema.optional(),
    /** Port the dev server listens on when given `--port <n>`; the supervisor assigns the number. */
    devPortFlag: z.string().min(1).default("--port"),
  }),
});
export type Template = z.infer<typeof TemplateSchema>;

export const ProjectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\\/:*?"<>|]+$/, "Name must not contain path separators or reserved characters.");

export const projectList = defineQuery({
  name: "project.list",
  input: z.object({ includeArchived: z.boolean().default(false) }).default({ includeArchived: false }),
  output: z.array(ProjectSchema),
  scope: "projects",
});

export const projectGet = defineQuery({
  name: "project.get",
  input: z.object({ id: ProjectIdSchema }),
  output: ProjectSchema,
  scope: "projects",
});

export const projectTemplates = defineQuery({
  name: "project.templates",
  input: z.void(),
  output: z.array(TemplateSchema),
  scope: "templates",
});

export const projectDefaultDirectory = defineQuery({
  name: "project.defaultDirectory",
  input: z.void(),
  output: z.object({ path: z.string().min(1) }),
  scope: "settings",
});

export const projectCreate = defineCommand({
  name: "project.create",
  input: z.object({
    name: ProjectNameSchema,
    templateId: z.string().min(1),
    /** Parent directory; defaults to the projects directory from settings. */
    parentDirectory: z.string().min(1).optional(),
  }),
  output: ProjectSchema,
  invalidates: ["projects"],
});

export const projectImport = defineCommand({
  name: "project.import",
  input: z.object({
    sourcePath: z.string().min(1),
    mode: z.enum(["in_place", "copy"]),
    name: ProjectNameSchema.optional(),
    /** For copy mode: parent directory of the copy; defaults to the projects directory. */
    parentDirectory: z.string().min(1).optional(),
  }),
  output: ProjectSchema,
  invalidates: ["projects"],
});

export const projectOpen = defineCommand({
  name: "project.open",
  input: z.object({ id: ProjectIdSchema }),
  output: ProjectSchema,
  invalidates: ["projects"],
});

export const projectRename = defineCommand({
  name: "project.rename",
  input: z.object({ id: ProjectIdSchema, name: ProjectNameSchema }),
  output: ProjectSchema,
  invalidates: ["projects"],
});

export const projectDelete = defineCommand({
  name: "project.delete",
  input: z.object({
    id: ProjectIdSchema,
    /** Remove the directory too. Refused for projects imported in place. */
    deleteFiles: z.boolean(),
    /** The user must retype the project name when deleting files. */
    confirmName: z.string().optional(),
  }),
  output: z.void(),
  invalidates: ["projects", "blueprint", "requirements", "memory"],
});

export const projectChanged = defineEvent({
  name: "project.changed",
  payload: z.object({ id: ProjectIdSchema, kind: z.enum(["created", "updated", "deleted"]) }),
});

export const ProjectSettingsSchema = z.object({
  runtimeProfile: RuntimeProfileSchema.default("host"),
  autoApprovePlansBelowComplexity: z.enum(["inherit", "none", "trivial", "standard"]).default("inherit"),
  contextBudgetTokens: z.number().int().min(4_000).max(400_000).default(60_000),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const projectSettingsGet = defineQuery({
  name: "project.settings.get",
  input: z.object({ projectId: ProjectIdSchema }),
  output: ProjectSettingsSchema,
  scope: "projectSettings",
});

export const projectSettingsUpdate = defineCommand({
  name: "project.settings.update",
  input: z.object({ projectId: ProjectIdSchema, patch: ProjectSettingsSchema.partial() }),
  output: ProjectSettingsSchema,
  invalidates: ["projectSettings", "projects"],
});

/** Host capability: native folder picker. Returns null when the user cancels. */
export const dialogPickDirectory = defineCommand({
  name: "dialog.pickDirectory",
  input: z.object({ title: z.string().max(120).optional(), defaultPath: z.string().optional() }),
  output: z.object({ path: z.string().nullable() }),
});
