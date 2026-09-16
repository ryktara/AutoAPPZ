import { readFileSync } from "node:fs";
import path from "node:path";
import { AppError } from "@autoappz/contracts";
import { collectFiles, contentTypeFor, digest } from "../files.ts";
import { api, sleep } from "../http.ts";
import type { DeployEvent, DeployInput, DeploymentAdapter, DiscoveredSite } from "../types.ts";

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

interface CfEnvelope<T> {
  success: boolean;
  result: T;
  errors?: { message: string }[];
}
interface CfProject {
  id?: string;
  name: string;
  subdomain?: string;
}
interface CfDeployment {
  id: string;
  url?: string;
  latest_stage?: { name: string; status: string };
}

/**
 * Cloudflare Pages direct upload: builds locally, uploads assets by hash with a short-lived upload
 * token, then creates a deployment from the manifest. Environment variables go on the project's
 * production config. UNVERIFIED: the asset-upload flow mirrors the public direct-upload API used by
 * Cloudflare's own CLI; covered by mocked tests only.
 */
export const cloudflareAdapter: DeploymentAdapter = {
  id: "cloudflare",
  displayName: "Cloudflare Pages",
  mode: "prebuilt",
  secret: {
    kind: "api-key",
    label: "Cloudflare API token",
    hint: "Needs the Cloudflare Pages edit permission",
  },
  configFields: [
    { key: "accountId", label: "Account id", required: true },
    { key: "projectName", label: "Pages project", required: true, placeholder: "my-app" },
  ],
  async discover(token, signal, apiBase = CLOUDFLARE_API) {
    const accounts = (
      await api<CfEnvelope<{ id: string; name: string }[]>>(`${apiBase}/accounts`, { token, signal })
    ).data.result;
    const out: DiscoveredSite[] = [];
    for (const account of accounts.slice(0, 5)) {
      const projects = (
        await api<CfEnvelope<CfProject[]>>(`${apiBase}/accounts/${account.id}/pages/projects`, {
          token,
          signal,
        })
      ).data.result;
      for (const p of projects)
        out.push({
          id: `${account.id}/${p.name}`,
          name: `${account.name} / ${p.name}`,
          url: p.subdomain ? `https://${p.subdomain}` : undefined,
          config: { accountId: account.id, projectName: p.name },
        });
    }
    return out;
  },
  readiness: ({ framework }) =>
    Promise.resolve(
      framework.static
        ? []
        : [
            {
              id: "cloudflare:static",
              label: "Static output",
              status: "fail" as const,
              detail: `${framework.framework} projects need a server; Pages direct upload serves static output only.`,
              fix: "Use the Docker or Vercel target for server apps, or make the build static.",
            },
          ],
    ),
  async *deploy(input: DeployInput): AsyncIterable<DeployEvent> {
    const token = input.secret;
    if (!token)
      throw new AppError(
        "precondition",
        "deploy.missing_secret",
        "No Cloudflare token is stored for this target.",
      );
    const base = input.apiBase ?? CLOUDFLARE_API;
    const accountId = input.target.config["accountId"];
    const projectName = input.target.config["projectName"];
    if (!accountId || !projectName)
      throw new AppError(
        "validation",
        "deploy.invalid_config",
        "Cloudflare account id and project name are required.",
      );
    const projectUrl = `${base}/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`;

    yield { kind: "step", name: "Build", status: "started" };
    const built = await input.build();
    if (!built.ok) {
      yield { kind: "step", name: "Build", status: "failed" };
      throw new AppError(
        "precondition",
        "deploy.build_failed",
        "The project build failed; see the log above.",
      );
    }
    yield { kind: "step", name: "Build", status: "done", detail: built.outputDir };

    const existing = await api<CfEnvelope<CfProject>>(projectUrl, {
      token,
      signal: input.signal,
      okStatuses: [404],
    });
    if (existing.status === 404) {
      yield { kind: "step", name: "Create project", status: "started" };
      await api(`${base}/accounts/${encodeURIComponent(accountId)}/pages/projects`, {
        method: "POST",
        token,
        signal: input.signal,
        body: { name: projectName, production_branch: "main" },
      });
      yield { kind: "step", name: "Create project", status: "done" };
    }
    if (Object.keys(input.env).length > 0) {
      yield { kind: "step", name: "Sync environment", status: "started" };
      const envVars = Object.fromEntries(
        Object.entries(input.env).map(([k, v]) => [k, { value: v, type: "secret_text" }]),
      );
      await api(projectUrl, {
        method: "PATCH",
        token,
        signal: input.signal,
        body: { deployment_configs: { production: { env_vars: envVars }, preview: { env_vars: envVars } } },
      });
      yield { kind: "step", name: "Sync environment", status: "done" };
    }

    yield { kind: "step", name: "Upload output", status: "started" };
    const outDir = path.join(input.projectRoot, built.outputDir);
    const files = collectFiles(outDir);
    const manifest: Record<string, string> = {};
    const byHash = new Map<string, { absolute: string; path: string }>();
    for (const f of files) {
      const hash = digest(f, "sha256").slice(0, 32);
      manifest[`/${f.path}`] = hash;
      byHash.set(hash, { absolute: f.absolute, path: f.path });
    }
    const jwt = (
      await api<CfEnvelope<{ jwt: string }>>(`${projectUrl}/upload-token`, { token, signal: input.signal })
    ).data.result.jwt;
    const missing = (
      await api<CfEnvelope<string[]>>(`${base}/pages/assets/check-missing`, {
        method: "POST",
        token: jwt,
        signal: input.signal,
        body: { hashes: [...byHash.keys()] },
      })
    ).data.result;
    const batch: { key: string; value: string; metadata: { contentType: string }; base64: true }[] = [];
    for (const hash of missing) {
      const file = byHash.get(hash);
      if (!file) continue;
      batch.push({
        key: hash,
        value: readFileSync(file.absolute).toString("base64"),
        metadata: { contentType: contentTypeFor(file.path) },
        base64: true,
      });
      if (batch.length >= 50) {
        await api(`${base}/pages/assets/upload`, {
          method: "POST",
          token: jwt,
          signal: input.signal,
          body: batch.splice(0),
        });
      }
    }
    if (batch.length > 0)
      await api(`${base}/pages/assets/upload`, {
        method: "POST",
        token: jwt,
        signal: input.signal,
        body: batch,
      });
    await api(`${base}/pages/assets/upsert-hashes`, {
      method: "POST",
      token: jwt,
      signal: input.signal,
      body: { hashes: [...byHash.keys()] },
    });
    yield {
      kind: "log",
      text: `uploaded ${String(missing.length)} of ${String(files.length)} file(s) (rest already on Cloudflare)`,
    };
    yield { kind: "step", name: "Upload output", status: "done" };

    yield { kind: "step", name: "Create deployment", status: "started" };
    const form = new FormData();
    form.set("manifest", JSON.stringify(manifest));
    form.set("branch", "main");
    const deployment = (
      await api<CfEnvelope<CfDeployment>>(`${projectUrl}/deployments`, {
        method: "POST",
        token,
        signal: input.signal,
        raw: form,
      })
    ).data.result;
    yield { kind: "step", name: "Create deployment", status: "done", detail: deployment.id };

    yield { kind: "step", name: "Publish", status: "started" };
    let state = deployment;
    for (
      let i = 0;
      i < 120 && !["success", "failure", "canceled"].includes(state.latest_stage?.status ?? "");
      i++
    ) {
      await sleep(input.pollIntervalMs ?? 2_000, input.signal);
      state = (
        await api<CfEnvelope<CfDeployment>>(`${projectUrl}/deployments/${deployment.id}`, {
          token,
          signal: input.signal,
        })
      ).data.result;
      yield {
        kind: "log",
        text: `${state.latest_stage?.name ?? "stage"}: ${state.latest_stage?.status ?? "unknown"}`,
      };
    }
    if (state.latest_stage?.status !== "success") {
      yield { kind: "step", name: "Publish", status: "failed", detail: state.latest_stage?.status };
      throw new AppError(
        "external",
        "deploy.failed",
        `Cloudflare reported ${state.latest_stage?.status ?? "an unknown state"}.`,
      );
    }
    yield { kind: "step", name: "Publish", status: "done" };
    yield { kind: "done", url: state.url, providerRef: state.id };
  },
};
