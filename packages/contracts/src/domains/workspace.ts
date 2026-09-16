import { z } from "zod";
import { defineEvent, defineQuery } from "../definitions.ts";

export const WorkspaceInfoSchema = z.object({
  appVersion: z.string().min(1),
  platform: z.enum(["darwin", "win32", "linux"]),
  dataDirectory: z.string().min(1),
  sessionId: z.string().min(1),
});
export type WorkspaceInfo = z.infer<typeof WorkspaceInfoSchema>;

export const workspaceInfo = defineQuery({
  name: "workspace.info",
  input: z.void(),
  output: WorkspaceInfoSchema,
  scope: "workspace",
});

export const workspaceReady = defineEvent({
  name: "workspace.ready",
  payload: WorkspaceInfoSchema,
});

export const cacheInvalidate = defineEvent({
  name: "cache.invalidate",
  payload: z.object({ scopes: z.array(z.string().min(1)).min(1) }),
});
