import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { AppError } from "@autoappz/contracts";

export interface UploadFile {
  /** Forward-slash path relative to the upload root. */
  readonly path: string;
  readonly absolute: string;
  readonly size: number;
}

export const MAX_UPLOAD_FILES = 5_000;
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const ALWAYS_SKIPPED = new Set(["node_modules", ".git", ".autoappz", ".vite", ".turbo", ".cache"]);
const SECRET_FILES = /^\.env(\..*)?$|\.(pem|key|p12|pfx)$/i;

/**
 * Lists files to upload under `dir`, never following symlinks, never including dependencies, VCS
 * metadata or secret-looking files, and refusing uploads over the size/count caps.
 */
export function collectFiles(
  dir: string,
  options: { readonly skipDirs?: readonly string[] | undefined } = {},
): UploadFile[] {
  const skip = new Set([...ALWAYS_SKIPPED, ...(options.skipDirs ?? [])]);
  const out: UploadFile[] = [];
  let total = 0;
  const walk = (rel: string) => {
    const abs = rel ? path.join(dir, rel) : dir;
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(childRel);
        continue;
      }
      if (!entry.isFile() || SECRET_FILES.test(entry.name)) continue;
      const size = statSync(path.join(dir, childRel)).size;
      total += size;
      out.push({ path: childRel, absolute: path.join(dir, childRel), size });
      if (out.length > MAX_UPLOAD_FILES || total > MAX_UPLOAD_BYTES) {
        throw new AppError(
          "precondition",
          "deploy.too_large",
          `The upload exceeds ${String(MAX_UPLOAD_FILES)} files or ${String(MAX_UPLOAD_BYTES / (1024 * 1024))} MB; check the output directory and ignore rules.`,
        );
      }
    }
  };
  walk("");
  return out;
}

export function digest(file: UploadFile, algorithm: "sha1" | "sha256"): string {
  return createHash(algorithm).update(readFileSync(file.absolute)).digest("hex");
}

export function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".txt": "text/plain",
    ".map": "application/json",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return map[ext] ?? "application/octet-stream";
}
