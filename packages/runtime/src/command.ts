import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { runtime as contracts } from "@autoappz/contracts";

type PackageManager = contracts.PackageManager;

/** A command ready to spawn: executable file plus leading args (never a shell string). */
export interface ResolvedCommand {
  readonly file: string;
  readonly args: readonly string[];
}

/** Package manager from the project's own declaration, then lockfiles, defaulting to pnpm. */
export function detectPackageManager(projectRoot: string): PackageManager {
  try {
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
      packageManager?: string;
    };
    const declared = pkg.packageManager?.split("@")[0];
    if (declared === "pnpm" || declared === "npm" || declared === "yarn" || declared === "bun")
      return declared;
  } catch {
    // no package.json or unreadable: fall through to lockfiles
  }
  if (existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(projectRoot, "bun.lock")) || existsSync(path.join(projectRoot, "bun.lockb")))
    return "bun";
  if (existsSync(path.join(projectRoot, "package-lock.json"))) return "npm";
  return "pnpm";
}

const WINDOWS_EXE_EXTS = [".exe", ".com"];

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  const raw = env["PATH"] ?? env["Path"] ?? "";
  return raw.split(path.delimiter).filter(Boolean);
}

/**
 * Finds an executable on PATH. On Windows, npm-style `.cmd` shims are resolved to `node <entry.js>` by
 * reading the shim, so nothing ever runs through cmd.exe. Returns undefined when not found.
 */
export function resolveExecutable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): ResolvedCommand | undefined {
  if (path.isAbsolute(name)) return existsSync(name) ? { file: name, args: [] } : undefined;
  for (const dir of pathEntries(env)) {
    if (platform === "win32") {
      for (const ext of WINDOWS_EXE_EXTS) {
        const candidate = path.join(dir, name + ext);
        if (isFile(candidate)) return { file: candidate, args: [] };
      }
      const shim = path.join(dir, `${name}.cmd`);
      if (isFile(shim)) {
        const resolved = resolveCmdShim(shim, env);
        if (resolved) return resolved;
      }
    } else {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) return { file: candidate, args: [] };
    }
  }
  return undefined;
}

/** Parses an npm-generated `.cmd` shim: `"%_prog%" "%dp0%\node_modules\<pkg>\bin\<entry>" %*`. */
export function resolveCmdShim(shimPath: string, env: NodeJS.ProcessEnv): ResolvedCommand | undefined {
  let text: string;
  try {
    text = readFileSync(shimPath, "utf8");
  } catch {
    return undefined;
  }
  const dir = path.dirname(shimPath);
  const m = /"%(?:~)?dp0%?\\?([^"]+\.(?:c?m?js))"/i.exec(text);
  if (!m?.[1]) return undefined;
  const entry = path.join(dir, m[1].replace(/^\\/, ""));
  if (!isFile(entry)) return undefined;
  const localNode = path.join(dir, "node.exe");
  const node = isFile(localNode) ? localNode : findNode(env);
  if (!node) return undefined;
  return { file: node, args: [entry] };
}

function findNode(env: NodeJS.ProcessEnv): string | undefined {
  for (const dir of pathEntries(env)) {
    const candidate = path.join(dir, process.platform === "win32" ? "node.exe" : "node");
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Environment passed to project processes: an allowlist, never the platform's full environment
 * (docs/architecture/RUNTIME.md). The project's own tooling handles its `.env` files.
 */
export function buildChildEnv(
  source: NodeJS.ProcessEnv,
  extra: Record<string, string> = {},
): Record<string, string> {
  const allow = [
    "PATH",
    "Path",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "TMPDIR",
    "SYSTEMROOT",
    "SystemRoot",
    "COMSPEC",
    "ComSpec",
    "LANG",
    "LC_ALL",
    "SHELL",
    "USER",
    "USERNAME",
    "PROGRAMFILES",
    "ProgramFiles",
    "PATHEXT",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "HOMEDRIVE",
    "HOMEPATH",
  ];
  const out: Record<string, string> = {};
  for (const key of allow) {
    const v = source[key];
    if (v !== undefined) out[key] = v;
  }
  out["NODE_ENV"] = source["NODE_ENV"] ?? "development";
  out["CI"] = "1"; // non-interactive: package managers must not prompt
  out["FORCE_COLOR"] = "0";
  out["NO_COLOR"] = "1";
  return { ...out, ...extra };
}
