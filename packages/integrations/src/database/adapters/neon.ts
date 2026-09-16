import { AppError } from "@autoappz/contracts";
import type { ConnectionTarget, DatabaseAdapter, DiscoveredInstance } from "../types.ts";
import { redactConnectionString } from "./postgres.ts";

export const NEON_API = "https://console.neon.tech/api/v2";

interface NeonProject {
  id: string;
  name: string;
  region_id?: string;
}
interface NeonBranch {
  id: string;
  name: string;
}
interface NeonEndpoint {
  id: string;
  branch_id: string;
  host: string;
}

/**
 * Neon serverless Postgres. Config holds project, branch and endpoint host (from the API); the secret is
 * the role password. Branch-per-task workflows can create branches through the same API later.
 * UNVERIFIED: API shapes follow the public v2 reference; tests use a mocked server.
 */
export const neonAdapter: DatabaseAdapter = {
  id: "neon",
  displayName: "Neon",
  secret: { kind: "password", label: "Role password", hint: "Neon console → Connection details → password" },
  configFields: [
    { key: "projectId", label: "Project id", required: true },
    { key: "branchId", label: "Branch id", required: false },
    { key: "host", label: "Endpoint host", required: true, placeholder: "ep-xxx.region.aws.neon.tech" },
    { key: "database", label: "Database", required: false, placeholder: "neondb" },
    { key: "user", label: "Role", required: false, placeholder: "neondb_owner" },
  ],
  connectionFor(config, secret): ConnectionTarget {
    const host = config["host"];
    if (!host) throw new AppError("validation", "db.invalid_config", "A Neon endpoint host is required.");
    if (!secret)
      throw new AppError(
        "precondition",
        "db.missing_secret",
        "No role password is stored for this Neon branch.",
      );
    const url = new URL("postgresql://localhost/");
    url.hostname = host;
    url.port = "5432";
    url.pathname = `/${config["database"] ?? "neondb"}`;
    url.username = config["user"] ?? "neondb_owner";
    url.password = secret;
    url.searchParams.set("sslmode", "require");
    return {
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: true },
      label: redactConnectionString(url.toString()),
    };
  },
  async discover(token, signal): Promise<DiscoveredInstance[]> {
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const projectsRes = await fetch(`${NEON_API}/projects`, { headers, signal });
    if (!projectsRes.ok)
      throw new AppError(
        "external",
        "db.discover_failed",
        `Neon API responded ${String(projectsRes.status)}.`,
      );
    const { projects } = (await projectsRes.json()) as { projects: NeonProject[] };
    const out: DiscoveredInstance[] = [];
    for (const p of projects.slice(0, 20)) {
      const branchesRes = await fetch(`${NEON_API}/projects/${encodeURIComponent(p.id)}/branches`, {
        headers,
        signal,
      });
      const endpointsRes = await fetch(`${NEON_API}/projects/${encodeURIComponent(p.id)}/endpoints`, {
        headers,
        signal,
      });
      const branches = branchesRes.ok
        ? ((await branchesRes.json()) as { branches: NeonBranch[] }).branches
        : [];
      const endpoints = endpointsRes.ok
        ? ((await endpointsRes.json()) as { endpoints: NeonEndpoint[] }).endpoints
        : [];
      out.push({
        id: p.id,
        name: p.name,
        region: p.region_id,
        config: { projectId: p.id },
        branches: branches.map((b) => ({
          id: b.id,
          name: b.name,
          config: {
            projectId: p.id,
            branchId: b.id,
            host: endpoints.find((e) => e.branch_id === b.id)?.host ?? "",
          },
        })),
      });
    }
    return out;
  },
};
