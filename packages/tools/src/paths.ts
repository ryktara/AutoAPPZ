import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { AppError } from "@autoappz/contracts";

/**
 * Project-root scoping for every filesystem tool (threat model: Tampering).
 * - input must be a relative, forward-slash path with no `..`, drive, UNC, `~` or NUL
 * - the resolved real path (following symlinks on every existing ancestor) must stay inside the
 *   real project root, so a symlink pointing outside the project is rejected
 * - `.git/` internals are never writable through tools
 */
export interface ResolvedPath {
  /** Normalised project-relative path with `/` separators. */
  readonly relative: string;
  /** Absolute filesystem path. */
  readonly absolute: string;
}

const RESERVED_WRITE_PREFIXES = [".git/", ".git"];

export function normalizeRelative(input: string): string {
  if (input.length === 0 || input.length > 4096) throw invalid(input, "empty or too long");
  if (input.includes("\0")) throw invalid(input, "contains NUL");
  const unified = input.replace(/\\/g, "/");
  if (
    unified.startsWith("/") ||
    unified.startsWith("//") ||
    /^[A-Za-z]:/.test(unified) ||
    unified.startsWith("~")
  ) {
    throw invalid(input, "must be relative to the project root");
  }
  const segments: string[] = [];
  for (const seg of unified.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") throw invalid(input, "must not contain '..'");
    segments.push(seg);
  }
  if (segments.length === 0) throw invalid(input, "refers to the project root itself");
  return segments.join("/");
}

export function resolveProjectPath(
  projectRoot: string,
  input: string,
  options: { forWrite?: boolean | undefined } = {},
): ResolvedPath {
  const relative = normalizeRelative(input);
  if (
    options.forWrite &&
    RESERVED_WRITE_PREFIXES.some((p) => relative === p.replace(/\/$/, "") || relative.startsWith(".git/"))
  ) {
    throw new AppError(
      "permission",
      "fs.reserved_path",
      "Files under .git/ cannot be modified through tools.",
      { details: { path: relative } },
    );
  }
  const root = realpathSync(projectRoot);
  const absolute = path.join(root, ...relative.split("/"));
  // Follow symlinks on the deepest existing ancestor and make sure we are still inside the root.
  let probe = absolute;
  while (!existsSync(probe)) probe = path.dirname(probe);
  const real = realpathSync(probe);
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new AppError(
      "permission",
      "fs.outside_project",
      "Path resolves outside the project (symlink or mount).",
      { details: { path: relative } },
    );
  }
  if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
    const target = realpathSync(absolute);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new AppError("permission", "fs.outside_project", "Symlink target is outside the project.", {
        details: { path: relative },
      });
    }
  }
  return { relative, absolute };
}

/** Env files are readable only through a dedicated redacting tool (M11); every other fs tool refuses them. */
export function isEnvFile(relative: string): boolean {
  const name = relative.split("/").pop() ?? "";
  return name === ".env" || (name.startsWith(".env.") && !name.endsWith(".example"));
}

function invalid(input: string, why: string): AppError {
  return new AppError("validation", "fs.invalid_path", `Invalid path: ${why}.`, { details: { path: input } });
}
