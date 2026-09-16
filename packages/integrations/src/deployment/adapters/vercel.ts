import { readFileSync } from "node:fs";
import { AppError } from "@autoappz/contracts";
import { collectFiles, digest } from "../files.ts";
import { api, sleep } from "../http.ts";
import type { DeployEvent, DeployInput, DeploymentAdapter, DiscoveredSite } from "../types.ts";

export const VERCEL_API = "https://api.vercel.com";

interface VercelProject {
  id: string;
  name: string;
  framework?: string | null;
}
interface VercelDeployment {
  id: string;
  url: string;
  readyState: "QUEUED" | "BUILDING" | "INITIALIZING" | "READY" | "ERROR" | "CANCELED";
  errorMessage?: string | null;
}

const FRAMEWORK_PRESET: Record<string, string | null> = {
  vite: "vite",
  nextjs: "nextjs",
  node: null,
  static: null,
  unknown: null,
};

/**
 * Vercel: uploads the project source (never node_modules or build output) and lets Vercel build it.
 * Environment variables are upserted on the project before the deployment is created.
 * UNVERIFIED: request shapes follow the public REST reference; covered by mocked tests only.
 */
export const vercelAdapter: DeploymentAdapter = {
  id: "vercel",
  displayName: "Vercel",
  mode: "source",
  secret: { kind: "api-key", label: "Vercel access token", hint: "Account settings → Tokens" },
  configFields: [
    { key: "projectName", label: "Project name", required: true, placeholder: "my-app" },
    { key: "teamId", label: "Team id", required: false, placeholder: "team_… (leave empty for personal)" },
  ],
  async discover(token, signal, apiBase = VERCEL_API) {
    const res = await api<{ projects: VercelProject[] }>(`${apiBase}/v9/projects?limit=100`, {
      token,
      signal,
    });
    return res.data.projects.map((p): DiscoveredSite => ({
      id: p.id,
      name: p.name,
      config: { projectName: p.name },
    }));
  },
  readiness: () => Promise.resolve([]),
  async *deploy(input: DeployInput): AsyncIterable<DeployEvent> {
    const token = input.secret;
    if (!token)
      throw new AppError(
        "precondition",
        "deploy.missing_secret",
        "No Vercel token is stored for this target.",
      );
    const base = input.apiBase ?? VERCEL_API;
    const team = input.target.config["teamId"]
      ? `?teamId=${encodeURIComponent(input.target.config["teamId"])}`
      : "";
    const projectName = input.target.config["projectName"];
    if (!projectName)
      throw new AppError("validation", "deploy.invalid_config", "A Vercel project name is required.");

    if (Object.keys(input.env).length > 0) {
      yield { kind: "step", name: "Sync environment", status: "started" };
      await api(
        `${base}/v10/projects/${encodeURIComponent(projectName)}/env${team ? `${team}&upsert=true` : "?upsert=true"}`,
        {
          method: "POST",
          token,
          signal: input.signal,
          body: Object.entries(input.env).map(([key, value]) => ({
            key,
            value,
            type: "encrypted",
            target: ["production", "preview"],
          })),
          okStatuses: [404],
        },
      );
      yield {
        kind: "step",
        name: "Sync environment",
        status: "done",
        detail: `${String(Object.keys(input.env).length)} variable(s)`,
      };
    }

    yield { kind: "step", name: "Upload source", status: "started" };
    const files = collectFiles(input.projectRoot, {
      skipDirs: [input.framework.outputDir, "dist", ".next", "out"],
    });
    const manifest: { file: string; sha: string; size: number }[] = [];
    for (const f of files) {
      const sha = digest(f, "sha1");
      await api(`${base}/v2/files${team}`, {
        method: "POST",
        token,
        signal: input.signal,
        raw: readFileSync(f.absolute),
        headers: { "x-vercel-digest": sha, "Content-Type": "application/octet-stream" },
        okStatuses: [409],
      });
      manifest.push({ file: f.path, sha, size: f.size });
    }
    yield { kind: "log", text: `uploaded ${String(files.length)} file(s)` };
    yield { kind: "step", name: "Upload source", status: "done" };

    yield { kind: "step", name: "Create deployment", status: "started" };
    const created = await api<VercelDeployment>(`${base}/v13/deployments${team}`, {
      method: "POST",
      token,
      signal: input.signal,
      body: {
        name: projectName,
        files: manifest,
        target: "production",
        projectSettings: { framework: FRAMEWORK_PRESET[input.framework.framework] ?? null },
      },
    });
    yield { kind: "log", text: `deployment ${created.data.id} queued` };
    yield { kind: "step", name: "Create deployment", status: "done", detail: created.data.id };

    yield { kind: "step", name: "Build on Vercel", status: "started" };
    let state = created.data;
    for (let i = 0; i < 300 && !["READY", "ERROR", "CANCELED"].includes(state.readyState); i++) {
      await sleep(input.pollIntervalMs ?? (i < 10 ? 2_000 : 5_000), input.signal);
      state = (
        await api<VercelDeployment>(`${base}/v13/deployments/${created.data.id}${team}`, {
          token,
          signal: input.signal,
        })
      ).data;
      yield { kind: "log", text: `state: ${state.readyState}` };
    }
    if (state.readyState !== "READY") {
      yield {
        kind: "step",
        name: "Build on Vercel",
        status: "failed",
        detail: state.errorMessage ?? state.readyState,
      };
      throw new AppError(
        "external",
        "deploy.failed",
        `Vercel reported ${state.readyState}${state.errorMessage ? `: ${state.errorMessage}` : ""}.`,
      );
    }
    yield { kind: "step", name: "Build on Vercel", status: "done" };
    yield { kind: "done", url: `https://${state.url}`, providerRef: state.id };
  },
};
