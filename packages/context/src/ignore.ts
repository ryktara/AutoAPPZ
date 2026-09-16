import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Directories never indexed regardless of gitignore. */
export const PLATFORM_EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".vite",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "coverage",
  ".autoappz",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
]);

const LOCKFILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "composer.lock",
  "Gemfile.lock",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".svg",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".mov",
  ".avi",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".node",
  ".wasm",
  ".class",
  ".jar",
  ".bin",
  ".db",
  ".sqlite",
  ".map",
]);

export const MAX_INDEXED_FILE_BYTES = 1024 * 1024;

/** Secret-looking files are never indexed, whatever the ignore rules say. */
export function isSecretPath(relativePath: string): boolean {
  const base = path.posix.basename(relativePath);
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (/\.(pem|key|p12|pfx|jks|keystore)$/i.test(base)) return true;
  if (/^(id_rsa|id_ed25519|id_ecdsa)(\.pub)?$/.test(base)) return true;
  if (/(^|\.)(secrets?|credentials?)\.(json|ya?ml|toml)$/i.test(base)) return true;
  return false;
}

export function isBinaryPath(relativePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
}

export function isLockfile(relativePath: string): boolean {
  return LOCKFILES.has(path.posix.basename(relativePath));
}

/** Cheap binary sniff: a NUL byte in the first 8 KB. */
export function looksBinary(buffer: Buffer): boolean {
  const n = Math.min(buffer.length, 8192);
  for (let i = 0; i < n; i++) if (buffer[i] === 0) return true;
  return false;
}

interface Rule {
  readonly regex: RegExp;
  readonly negate: boolean;
  readonly dirOnly: boolean;
}

/**
 * Minimal gitignore matcher: `*`, `**`, `?`, leading `/` (anchored), trailing `/` (directories), `!` negation,
 * `#` comments. Patterns without a slash match at any depth, as git does. Only the root `.gitignore` is read
 * (nested ignore files are a deferred refinement).
 */
export class IgnoreRules {
  private readonly rules: Rule[];

  constructor(patterns: readonly string[]) {
    this.rules = patterns.map(compile).filter((r): r is Rule => r !== undefined);
  }

  static fromProject(root: string): IgnoreRules {
    const file = path.join(root, ".gitignore");
    const patterns = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
    return new IgnoreRules(patterns);
  }

  /** `relativePath` uses forward slashes; `isDir` enables directory-only rules. */
  ignores(relativePath: string, isDir: boolean): boolean {
    const segments = relativePath.split("/");
    if (segments.some((s) => PLATFORM_EXCLUDED_DIRS.has(s))) return true;
    if (!isDir && (isSecretPath(relativePath) || isBinaryPath(relativePath) || isLockfile(relativePath)))
      return true;
    // Any ancestor directory matched by a directory rule ignores the whole subtree.
    let ignored = false;
    for (let i = 1; i <= segments.length; i++) {
      const sub = segments.slice(0, i).join("/");
      const subIsDir = i < segments.length || isDir;
      for (const rule of this.rules) {
        if (rule.dirOnly && !subIsDir) continue;
        if (rule.regex.test(sub)) ignored = !rule.negate;
      }
    }
    return ignored;
  }
}

function compile(raw: string): Rule | undefined {
  let p = raw.trim();
  if (p.length === 0 || p.startsWith("#")) return undefined;
  let negate = false;
  if (p.startsWith("!")) {
    negate = true;
    p = p.slice(1);
  }
  let dirOnly = false;
  if (p.endsWith("/")) {
    dirOnly = true;
    p = p.slice(0, -1);
  }
  let anchored = false;
  if (p.startsWith("/")) {
    anchored = true;
    p = p.slice(1);
  } else if (p.includes("/")) {
    anchored = true;
  }
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i] ?? "";
    if (c === "*") {
      if (p[i + 1] === "*") {
        re += "(?:.*)";
        i += 1;
        if (p[i + 1] === "/") i += 1;
        if (re.endsWith("(?:.*)") && i + 1 < p.length) re += "(?:/)?";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const regex = new RegExp(anchored ? `^${re}$` : `(^|/)${re}$`);
  return { regex, negate, dirOnly };
}
