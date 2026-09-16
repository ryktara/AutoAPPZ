import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { AppError } from "@autoappz/contracts";

export interface PathPolicy {
  /** App data directory; projects may never live inside it. */
  readonly dataDirectory: string;
  /** User home; a project may live under it but never be it. */
  readonly homeDirectory: string;
}

export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug.length > 0 ? slug : "project";
}

function normalize(p: string): string {
  return path.resolve(p).replace(/[\\/]+$/, "");
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * A project directory must be absolute, must not be a filesystem root, the home directory itself,
 * or anything inside the app data directory.
 */
export function assertAllowedProjectDirectory(dir: string, policy: PathPolicy): string {
  if (!path.isAbsolute(dir)) {
    throw new AppError("validation", "project.path_not_absolute", "Project path must be absolute.", {
      details: { dir },
    });
  }
  const abs = normalize(dir);
  const root = path.parse(abs).root.replace(/[\\/]+$/, "");
  if (abs === root || abs === "") {
    throw new AppError("validation", "project.path_is_root", "A filesystem root cannot be a project.", {
      details: { dir },
    });
  }
  if (abs === normalize(policy.homeDirectory)) {
    throw new AppError("validation", "project.path_is_home", "The home directory cannot be a project.", {
      details: { dir },
    });
  }
  if (isInside(abs, normalize(policy.dataDirectory))) {
    throw new AppError(
      "validation",
      "project.path_in_data_dir",
      "Projects cannot live inside the app data directory.",
      {
        details: { dir },
      },
    );
  }
  return abs;
}

export function assertEmptyOrMissing(dir: string): void {
  if (!existsSync(dir)) return;
  if (!statSync(dir).isDirectory()) {
    throw new AppError("conflict", "project.path_is_file", "The target path exists and is not a directory.", {
      details: { dir },
    });
  }
  if (readdirSync(dir).length > 0) {
    throw new AppError("conflict", "project.path_not_empty", "The target directory is not empty.", {
      details: { dir },
    });
  }
}

export function assertExistingDirectory(dir: string): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new AppError("not_found", "project.path_missing", "The folder does not exist.", {
      details: { dir },
    });
  }
}

/** Picks `<parent>/<slug>`, appending -2, -3 … when taken. */
export function uniqueChildDirectory(parent: string, slug: string): string {
  let candidate = path.join(parent, slug);
  let n = 2;
  while (existsSync(candidate)) {
    candidate = path.join(parent, `${slug}-${String(n)}`);
    n += 1;
    if (n > 500)
      throw new AppError("conflict", "project.no_free_directory", "Could not find a free directory name.");
  }
  return candidate;
}
