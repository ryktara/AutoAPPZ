import { AppError } from "@autoappz/contracts";
import type { DatabaseAdapter } from "../types.ts";

/** Redacts the password of a connection string for labels and logs. */
export function redactConnectionString(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "postgresql://***";
  }
}

export function assertPostgresUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("validation", "db.invalid_url", "The connection string is not a valid URL.");
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new AppError(
      "validation",
      "db.invalid_url",
      "The connection string must start with postgres:// or postgresql://.",
    );
  }
}

/**
 * Plain PostgreSQL: either a full connection string secret (`mode: "url"`) or host/port/database/user in
 * the config with the password as the secret (`mode: "fields"`).
 */
export const postgresAdapter: DatabaseAdapter = {
  id: "postgres",
  displayName: "PostgreSQL",
  secret: {
    kind: "connection-string",
    label: "Connection string or password",
    hint: "postgresql://user:password@host:5432/db, or just the password when host fields are filled in",
  },
  configFields: [
    { key: "host", label: "Host", required: false, placeholder: "localhost" },
    { key: "port", label: "Port", required: false, placeholder: "5432" },
    { key: "database", label: "Database", required: false, placeholder: "app" },
    { key: "user", label: "User", required: false, placeholder: "postgres" },
    { key: "sslmode", label: "SSL", required: false, placeholder: "disable | require" },
  ],
  connectionFor(config, secret) {
    if (!secret)
      throw new AppError(
        "precondition",
        "db.missing_secret",
        "No connection secret is stored for this database.",
      );
    const ssl = (config["sslmode"] ?? "").toLowerCase() === "require" ? { rejectUnauthorized: false } : false;
    if (config["host"]) {
      const url = new URL("postgresql://localhost/");
      url.hostname = config["host"];
      url.port = config["port"] ?? "5432";
      url.pathname = `/${config["database"] ?? "postgres"}`;
      url.username = config["user"] ?? "postgres";
      url.password = secret;
      return { connectionString: url.toString(), ssl, label: redactConnectionString(url.toString()) };
    }
    assertPostgresUrl(secret);
    const sslFromUrl = /[?&]sslmode=(require|verify-full|verify-ca)/.test(secret);
    return {
      connectionString: secret,
      ssl: ssl || (sslFromUrl ? { rejectUnauthorized: false } : false),
      label: redactConnectionString(secret),
    };
  },
};
