import type { DeploymentAdapter, DeploymentTarget, FrameworkInfo, ReadinessItem } from "./types.ts";

export interface ReadinessContext {
  readonly projectRoot: string;
  readonly target: DeploymentTarget;
  readonly adapter: DeploymentAdapter;
  readonly framework: FrameworkInfo;
  readonly secret: string | undefined;
  /** Environment the app declares (template manifest) and whether each has a value for this target. */
  readonly env: readonly {
    name: string;
    required: boolean;
    resolved: boolean;
    source?: string | undefined;
  }[];
  readonly git: { isRepository: boolean; dirty: number } | undefined;
  /** Outcome of the latest validation run, when known. */
  readonly lastValidation?: { ok: boolean; summary: string } | undefined;
}

/** Cross-adapter readiness checklist; adapters append their own items. */
export async function buildReadiness(
  ctx: ReadinessContext,
): Promise<{ items: ReadinessItem[]; ready: boolean }> {
  const items: ReadinessItem[] = [];
  items.push(
    ctx.framework.framework === "unknown"
      ? {
          id: "framework",
          label: "Framework detected",
          status: "warn",
          detail:
            "Could not detect the framework; the Docker and source-upload paths still work if the build script is correct.",
        }
      : {
          id: "framework",
          label: "Framework detected",
          status: "ok",
          detail: `${ctx.framework.framework} → ${ctx.framework.outputDir}`,
        },
  );
  items.push(
    ctx.framework.hasBuildScript
      ? {
          id: "build-script",
          label: "Build script present",
          status: "ok",
          detail: `${ctx.framework.packageManager} run build`,
        }
      : ctx.adapter.mode === "prebuilt" || ctx.framework.framework !== "static"
        ? {
            id: "build-script",
            label: "Build script present",
            status: "fail",
            detail: "package.json has no build script.",
            fix: "Add a build script that writes the production output.",
          }
        : {
            id: "build-script",
            label: "Build script present",
            status: "ok",
            detail: "static site, no build needed",
          },
  );
  if (ctx.adapter.secret) {
    items.push(
      ctx.secret
        ? {
            id: "credential",
            label: `${ctx.adapter.displayName} credential`,
            status: "ok",
            detail: "stored as a secret",
          }
        : {
            id: "credential",
            label: `${ctx.adapter.displayName} credential`,
            status: "fail",
            detail: "No API token stored for this target.",
            fix: "Add the token in the Deploy card.",
          },
    );
  }
  for (const field of ctx.adapter.configFields) {
    if (field.required && !ctx.target.config[field.key]) {
      items.push({
        id: `config:${field.key}`,
        label: field.label,
        status: "fail",
        detail: "Required setting is empty.",
        fix: `Fill in ${field.label}.`,
      });
    }
  }
  for (const e of ctx.env) {
    items.push(
      e.resolved
        ? {
            id: `env:${e.name}`,
            label: `Environment: ${e.name}`,
            status: "ok",
            detail: e.source ?? "value set",
          }
        : {
            id: `env:${e.name}`,
            label: `Environment: ${e.name}`,
            status: e.required ? "fail" : "warn",
            detail: "No value for this target.",
            fix: e.required
              ? "Set a value in the Deploy card (attach a database for DATABASE_URL)."
              : undefined,
          },
    );
  }
  if (ctx.git) {
    items.push(
      !ctx.git.isRepository
        ? {
            id: "git",
            label: "Committed changes",
            status: "warn",
            detail: "Not a git repository; deployments cannot be traced to a commit.",
          }
        : ctx.git.dirty > 0
          ? {
              id: "git",
              label: "Committed changes",
              status: "warn",
              detail: `${String(ctx.git.dirty)} uncommitted change(s) will be deployed as they are on disk.`,
              fix: "Commit in the Project tab → Git.",
            }
          : { id: "git", label: "Committed changes", status: "ok", detail: "working tree clean" },
    );
  }
  if (ctx.lastValidation) {
    items.push(
      ctx.lastValidation.ok
        ? { id: "checks", label: "Project checks", status: "ok", detail: ctx.lastValidation.summary }
        : {
            id: "checks",
            label: "Project checks",
            status: "warn",
            detail: ctx.lastValidation.summary,
            fix: "Run Diagnose & fix in the Validation tab.",
          },
    );
  }
  items.push(
    ...(await ctx.adapter.readiness({
      projectRoot: ctx.projectRoot,
      target: ctx.target,
      framework: ctx.framework,
      secret: ctx.secret,
    })),
  );
  return { items, ready: !items.some((i) => i.status === "fail") };
}
