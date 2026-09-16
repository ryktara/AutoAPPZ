import { AppError } from "@autoappz/contracts";
import type { ConnectionTarget, DatabaseAdapter, DiscoveredInstance } from "../types.ts";
import { redactConnectionString } from "./postgres.ts";

export const SUPABASE_API = "https://api.supabase.com/v1";

interface SupabaseProject {
  id: string;
  name: string;
  region: string;
  database?: { host?: string; version?: string } | undefined;
}

/**
 * Supabase Postgres. Config holds the project ref and the database host reported by the management
 * API; the secret is the database password (a Supabase access token is only used transiently for
 * discovery and is never stored with the integration). Direct connections use port 5432 with TLS.
 * UNVERIFIED: the management API response shape is taken from public docs and covered by mocked tests only.
 */
export const supabaseAdapter: DatabaseAdapter = {
  id: "supabase",
  displayName: "Supabase",
  secret: { kind: "password", label: "Database password", hint: "Project settings → Database → password" },
  configFields: [
    { key: "projectRef", label: "Project ref", required: true, placeholder: "abcdefghijklmnop" },
    { key: "host", label: "Database host", required: false, placeholder: "db.<ref>.supabase.co" },
    { key: "database", label: "Database", required: false, placeholder: "postgres" },
    { key: "user", label: "User", required: false, placeholder: "postgres" },
  ],
  connectionFor(config, secret): ConnectionTarget {
    const ref = config["projectRef"];
    if (!ref) throw new AppError("validation", "db.invalid_config", "A Supabase project ref is required.");
    if (!secret)
      throw new AppError(
        "precondition",
        "db.missing_secret",
        "No database password is stored for this Supabase project.",
      );
    const url = new URL("postgresql://localhost/");
    url.hostname = config["host"] ?? `db.${ref}.supabase.co`;
    url.port = "5432";
    url.pathname = `/${config["database"] ?? "postgres"}`;
    url.username = config["user"] ?? "postgres";
    url.password = secret;
    return {
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: false },
      label: redactConnectionString(url.toString()),
    };
  },
  async discover(token, signal): Promise<DiscoveredInstance[]> {
    const res = await fetch(`${SUPABASE_API}/projects`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!res.ok)
      throw new AppError("external", "db.discover_failed", `Supabase API responded ${String(res.status)}.`);
    const projects = (await res.json()) as SupabaseProject[];
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      region: p.region,
      config: {
        projectRef: p.id,
        host: p.database?.host ?? `db.${p.id}.supabase.co`,
        database: "postgres",
        user: "postgres",
      },
    }));
  },
};
