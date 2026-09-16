import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { isEnvFile, normalizeRelative } from "../paths.ts";
import type { AgentTool } from "../runtime.ts";

const SearchInput = z.object({
  query: z.string().min(1).max(500),
  /** Treat query as a regular expression (default: literal). */
  regex: z.boolean().default(false),
  /** Restrict to a project-relative directory or glob, e.g. "src" or "**\/*.tsx". */
  path: z.string().max(4096).optional(),
  caseSensitive: z.boolean().default(false),
  maxResults: z.number().int().min(1).max(500).default(100),
});
const SearchOutput = z.object({
  matches: z.array(z.object({ path: z.string(), line: z.number().int(), text: z.string() })),
  truncated: z.boolean(),
  engine: z.enum(["ripgrep", "node"]),
});
type SearchIn = z.infer<typeof SearchInput>;
type SearchOut = z.infer<typeof SearchOutput>;

export interface SearchOptions {
  /** Absolute path to the ripgrep binary; undefined → Node fallback (used in tests and when the binary is missing). */
  readonly rgPath?: string | undefined;
}

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".vite", ".next", "coverage"]);

/** Text search over the project (ripgrep when available, Node fallback). Never reads env files. */
export function createSearchTool(options: SearchOptions = {}): AgentTool<SearchIn, SearchOut> {
  return {
    id: "search.text",
    description:
      "Search file contents in the project for a literal string or regex. Returns file, line and matching text.",
    inputSchema: SearchInput,
    outputSchema: SearchOutput,
    permission: {
      capability: "fs.read",
      risk: "low",
      scope: (i) => (i.path ? `${i.path}/**` : "**"),
      defaultPolicy: "allow",
      describe: (i) => `Search for "${i.query}"`,
    },
    timeoutMs: 20_000,
    mutates: false,
    async execute(input, ctx) {
      const subdir = input.path ? normalizeRelative(input.path) : undefined;
      const result =
        options.rgPath && existsSync(options.rgPath)
          ? await runRipgrep(options.rgPath, ctx.projectRoot, input, subdir, ctx.signal)
          : nodeSearch(ctx.projectRoot, input, subdir);
      const matches = result.matches.filter((m) => !isEnvFile(m.path));
      const summary =
        matches.length === 0
          ? `No matches for "${input.query}".`
          : matches.map((m) => `${m.path}:${String(m.line)}: ${m.text.trim().slice(0, 200)}`).join("\n") +
            (result.truncated ? "\n…[more matches omitted]" : "");
      return {
        ok: true,
        value: { matches, truncated: result.truncated, engine: result.engine },
        summaryForModel: summary,
      };
    },
  };
}

async function runRipgrep(
  rgPath: string,
  root: string,
  input: SearchIn,
  subdir: string | undefined,
  signal: AbortSignal,
): Promise<SearchOut> {
  const args = ["--json", "--max-count", String(input.maxResults), "--no-messages"];
  if (!input.regex) args.push("--fixed-strings");
  if (!input.caseSensitive) args.push("--ignore-case");
  for (const d of IGNORED_DIRS) args.push("--glob", `!${d}`);
  args.push("--glob", "!.env", "--glob", "!.env.*");
  args.push("--", input.query, subdir ?? ".");
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(rgPath, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      signal,
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    child.stdout.on("data", (c: Buffer) => {
      bytes += c.length;
      if (bytes < 4 * 1024 * 1024) chunks.push(c);
    });
    child.on("error", reject);
    child.on("close", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
  const matches: SearchOut["matches"] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    let ev: {
      type: string;
      data: { path: { text?: string }; line_number?: number; lines: { text?: string } };
    };
    try {
      ev = JSON.parse(line) as typeof ev;
    } catch {
      continue;
    }
    if (ev.type !== "match") continue;
    const p = (ev.data.path.text ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
    matches.push({
      path: p,
      line: ev.data.line_number ?? 0,
      text: (ev.data.lines.text ?? "").replace(/\r?\n$/, ""),
    });
    if (matches.length >= input.maxResults) break;
  }
  return { matches, truncated: matches.length >= input.maxResults, engine: "ripgrep" };
}

function nodeSearch(root: string, input: SearchIn, subdir: string | undefined): SearchOut {
  const re = input.regex ? new RegExp(input.query, input.caseSensitive ? "" : "i") : undefined;
  const needle = input.caseSensitive ? input.query : input.query.toLowerCase();
  const matches: SearchOut["matches"] = [];
  let truncated = false;
  const walk = (abs: string, rel: string) => {
    if (truncated) return;
    let names: string[];
    try {
      names = readdirSync(abs).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (IGNORED_DIRS.has(name)) continue;
      const childAbs = path.join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      const st = statSync(childAbs);
      if (st.isDirectory()) {
        walk(childAbs, childRel);
        continue;
      }
      if (st.size > 2 * 1024 * 1024 || isEnvFile(childRel)) continue;
      const text = readFileSync(childAbs, "utf8");
      if (text.includes("\0")) continue;
      text.split("\n").forEach((line, i) => {
        if (truncated) return;
        const hit = re ? re.test(line) : (input.caseSensitive ? line : line.toLowerCase()).includes(needle);
        if (hit) {
          matches.push({ path: childRel, line: i + 1, text: line });
          if (matches.length >= input.maxResults) truncated = true;
        }
      });
    }
  };
  const start = subdir ? path.join(root, ...subdir.split("/")) : root;
  walk(start, subdir ?? "");
  return { matches, truncated, engine: "node" };
}
