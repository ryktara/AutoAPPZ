import { readFileSync } from "node:fs";
import path from "node:path";
import { AppError } from "@autoappz/contracts";
import { collectFiles, contentTypeFor, digest } from "../files.ts";
import { api, sleep } from "../http.ts";
import type { DeployEvent, DeployInput, DeploymentAdapter, DiscoveredSite } from "../types.ts";

export const NETLIFY_API = "https://api.netlify.com/api/v1";

interface NetlifySite {
  id: string;
  name: string;
  ssl_url?: string;
  url?: string;
  account_slug?: string;
}
interface NetlifyDeploy {
  id: string;
  state: string;
  required?: string[];
  ssl_url?: string;
  deploy_ssl_url?: string;
  url?: string;
  error_message?: string | null;
}

/**
 * Netlify: builds locally, then uploads the output with the file-digest deploy API (only files whose
 * SHA1 Netlify does not already have are sent). Environment variables are set on the site's account.
 * UNVERIFIED: request shapes follow the public API reference; covered by mocked tests only.
 */
export const netlifyAdapter: DeploymentAdapter = {
  id: "netlify",
  displayName: "Netlify",
  mode: "prebuilt",
  secret: {
    kind: "api-key",
    label: "Netlify personal access token",
    hint: "User settings → Applications → Personal access tokens",
  },
  configFields: [
    {
      key: "siteId",
      label: "Site id",
      required: false,
      placeholder: "pick a site below or leave empty to create one",
    },
    { key: "siteName", label: "Site name (when creating)", required: false, placeholder: "my-app" },
  ],
  async discover(token, signal, apiBase = NETLIFY_API) {
    const res = await api<NetlifySite[]>(`${apiBase}/sites?per_page=100`, { token, signal });
    return res.data.map((s): DiscoveredSite => ({
      id: s.id,
      name: s.name,
      url: s.ssl_url ?? s.url,
      config: { siteId: s.id },
    }));
  },
  readiness: ({ framework }) =>
    Promise.resolve(
      framework.static
        ? []
        : [
            {
              id: "netlify:static",
              label: "Static output",
              status: "fail" as const,
              detail: `${framework.framework} projects need a server; Netlify direct deploys serve static output only.`,
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
        "No Netlify token is stored for this target.",
      );
    const base = input.apiBase ?? NETLIFY_API;

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

    let siteId = input.target.config["siteId"];
    let site: NetlifySite;
    if (siteId) {
      site = (
        await api<NetlifySite>(`${base}/sites/${encodeURIComponent(siteId)}`, { token, signal: input.signal })
      ).data;
    } else {
      yield { kind: "step", name: "Create site", status: "started" };
      const siteName = input.target.config["siteName"];
      site = (
        await api<NetlifySite>(`${base}/sites`, {
          method: "POST",
          token,
          signal: input.signal,
          body: { name: siteName?.length ? siteName : undefined },
        })
      ).data;
      siteId = site.id;
      yield { kind: "step", name: "Create site", status: "done", detail: site.name };
    }

    if (Object.keys(input.env).length > 0 && site.account_slug) {
      yield { kind: "step", name: "Sync environment", status: "started" };
      await api(
        `${base}/accounts/${encodeURIComponent(site.account_slug)}/env?site_id=${encodeURIComponent(siteId)}`,
        {
          method: "POST",
          token,
          signal: input.signal,
          body: Object.entries(input.env).map(([key, value]) => ({
            key,
            scopes: ["builds", "functions", "runtime"],
            values: [{ value, context: "all" }],
          })),
          okStatuses: [409],
        },
      );
      yield { kind: "step", name: "Sync environment", status: "done" };
    }

    yield { kind: "step", name: "Upload output", status: "started" };
    const outDir = path.join(input.projectRoot, built.outputDir);
    const files = collectFiles(outDir);
    const shas = new Map<string, string>();
    const manifest: Record<string, string> = {};
    for (const f of files) {
      const sha = digest(f, "sha1");
      shas.set(sha, f.absolute);
      manifest[`/${f.path}`] = sha;
    }
    const deploy = (
      await api<NetlifyDeploy>(`${base}/sites/${encodeURIComponent(siteId)}/deploys`, {
        method: "POST",
        token,
        signal: input.signal,
        body: { files: manifest, draft: false },
      })
    ).data;
    const required = new Set(deploy.required ?? []);
    let uploaded = 0;
    for (const [filePath, sha] of Object.entries(manifest)) {
      if (!required.has(sha)) continue;
      const absolute = shas.get(sha);
      if (!absolute) continue;
      await api(`${base}/deploys/${deploy.id}/files${filePath}`, {
        method: "PUT",
        token,
        signal: input.signal,
        raw: readFileSync(absolute),
        headers: { "Content-Type": contentTypeFor(filePath) },
      });
      uploaded += 1;
    }
    yield {
      kind: "log",
      text: `uploaded ${String(uploaded)} of ${String(files.length)} file(s) (rest already on Netlify)`,
    };
    yield { kind: "step", name: "Upload output", status: "done" };

    yield { kind: "step", name: "Publish", status: "started" };
    let state = deploy;
    for (let i = 0; i < 120 && !["ready", "error"].includes(state.state); i++) {
      await sleep(input.pollIntervalMs ?? 2_000, input.signal);
      state = (await api<NetlifyDeploy>(`${base}/deploys/${deploy.id}`, { token, signal: input.signal }))
        .data;
      yield { kind: "log", text: `state: ${state.state}` };
    }
    if (state.state !== "ready") {
      yield { kind: "step", name: "Publish", status: "failed", detail: state.error_message ?? state.state };
      throw new AppError(
        "external",
        "deploy.failed",
        `Netlify reported ${state.state}${state.error_message ? `: ${state.error_message}` : ""}.`,
      );
    }
    yield { kind: "step", name: "Publish", status: "done" };
    yield {
      kind: "done",
      url: state.ssl_url ?? state.deploy_ssl_url ?? state.url ?? site.ssl_url,
      providerRef: state.id,
    };
  },
};
