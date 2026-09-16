import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import { isEnvFile, resolveProjectPath } from "../paths.ts";
import { contentHash } from "../read-ledger.ts";
import type { AgentTool, ToolContext, ToolResult } from "../runtime.ts";

const PathInput = z.string().min(1).max(4096);
const MAX_READ_BYTES = 512 * 1024;
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".vite",
  ".next",
  "coverage",
  ".turbo",
]);

const fail = <O>(code: string, message: string, details?: Record<string, unknown>): ToolResult<O> => ({
  ok: false,
  error: { code, message, details },
  summaryForModel: message,
});

function guardEnv<O>(relative: string): ToolResult<O> | undefined {
  return isEnvFile(relative)
    ? fail<O>(
        "fs.env_protected",
        `${relative} holds secrets and is not readable through this tool. Ask the user for the variable names you need.`,
      )
    : undefined;
}

/** Ensures a write targets a file the model has read (or is new) and that nobody changed it since. */
function checkWriteConflict<O>(
  ctx: ToolContext,
  relative: string,
  absolute: string,
  expectedHash: string | undefined,
): ToolResult<O> | undefined {
  const exists = existsSync(absolute);
  if (!exists) return undefined;
  const current = contentHash(readFileSync(absolute));
  const expected = expectedHash ?? ctx.ledger.lastReadHash(relative);
  if (expected === undefined) {
    return fail<O>(
      "fs.read_before_write",
      `Read ${relative} before modifying it (the file exists and has not been read in this task).`,
      { currentHash: current },
    );
  }
  if (expected !== current) {
    return fail<O>(
      "fs.conflict",
      `${relative} changed since it was read (hash ${expected} → ${current}). Re-read it and apply your change again.`,
      { expectedHash: expected, currentHash: current },
    );
  }
  return undefined;
}

// ---------------------------------------------------------------- fs.read

const ReadInput = z.object({
  path: PathInput,
  /** 1-based inclusive line range for large files. */
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
});
const ReadOutput = z.object({
  path: z.string(),
  content: z.string(),
  hash: z.string(),
  totalLines: z.number().int(),
  truncated: z.boolean(),
});

export const fsRead: AgentTool<z.infer<typeof ReadInput>, z.infer<typeof ReadOutput>> = {
  id: "fs.read",
  description:
    "Read a text file inside the project. Returns the content (optionally a line range), its hash for later edits, and the total line count.",
  inputSchema: ReadInput,
  outputSchema: ReadOutput,
  permission: {
    capability: "fs.read",
    risk: "low",
    scope: (i) => i.path,
    defaultPolicy: "allow",
    describe: (i) => `Read ${i.path}`,
  },
  timeoutMs: 5_000,
  mutates: false,
  execute(input, ctx) {
    const { relative, absolute } = resolveProjectPath(ctx.projectRoot, input.path);
    const env = guardEnv<z.infer<typeof ReadOutput>>(relative);
    if (env) return Promise.resolve(env);
    if (!existsSync(absolute)) return Promise.resolve(fail("fs.not_found", `${relative} does not exist.`));
    const st = statSync(absolute);
    if (st.isDirectory())
      return Promise.resolve(fail("fs.is_directory", `${relative} is a directory; use fs.list.`));
    const raw = readFileSync(absolute);
    const hash = contentHash(raw);
    ctx.ledger.recordRead(relative, hash);
    const text = raw.subarray(0, MAX_READ_BYTES).toString("utf8");
    const lines = text.split("\n");
    const start = input.startLine ?? 1;
    const end = Math.min(input.endLine ?? lines.length, lines.length);
    const slice = lines.slice(start - 1, end);
    const content = slice.map((l, i) => `${String(start + i).padStart(4, " ")}| ${l}`).join("\n");
    const truncated = raw.byteLength > MAX_READ_BYTES;
    return Promise.resolve({
      ok: true,
      value: { path: relative, content, hash, totalLines: lines.length, truncated },
      summaryForModel: `${relative} (${String(lines.length)} lines, hash ${hash})${truncated ? " [truncated at 512 KiB]" : ""}:\n${content}`,
    });
  },
};

// ---------------------------------------------------------------- fs.list

const ListInput = z.object({
  path: PathInput.default("."),
  depth: z.number().int().min(1).max(6).default(2),
  limit: z.number().int().min(1).max(2000).default(500),
});
const ListOutput = z.object({
  entries: z.array(
    z.object({ path: z.string(), kind: z.enum(["file", "dir"]), size: z.number().int().optional() }),
  ),
  truncated: z.boolean(),
});

export const fsList: AgentTool<z.infer<typeof ListInput>, z.infer<typeof ListOutput>> = {
  id: "fs.list",
  description:
    "List files and folders under a project path (node_modules, .git and build output are skipped).",
  inputSchema: ListInput,
  outputSchema: ListOutput,
  permission: {
    capability: "fs.read",
    risk: "low",
    scope: (i) => (i.path === "." ? "**" : `${i.path}/**`),
    defaultPolicy: "allow",
    describe: (i) => `List ${i.path}`,
  },
  timeoutMs: 10_000,
  mutates: false,
  execute(input, ctx) {
    const rootAbs =
      input.path === "." ? ctx.projectRoot : resolveProjectPath(ctx.projectRoot, input.path).absolute;
    const rootRel = input.path === "." ? "" : resolveProjectPath(ctx.projectRoot, input.path).relative;
    if (!existsSync(rootAbs) || !statSync(rootAbs).isDirectory())
      return Promise.resolve(fail("fs.not_found", `${input.path} is not a directory.`));
    const entries: { path: string; kind: "file" | "dir"; size?: number }[] = [];
    let truncated = false;
    const walk = (abs: string, rel: string, depth: number) => {
      if (truncated) return;
      for (const name of readdirSync(abs).sort()) {
        if (IGNORED_DIRS.has(name)) continue;
        const childAbs = path.join(abs, name);
        const childRel = rel ? `${rel}/${name}` : name;
        let st;
        try {
          st = statSync(childAbs);
        } catch {
          continue;
        }
        if (entries.length >= input.limit) {
          truncated = true;
          return;
        }
        if (st.isDirectory()) {
          entries.push({ path: childRel, kind: "dir" });
          if (depth < input.depth) walk(childAbs, childRel, depth + 1);
        } else {
          entries.push({ path: childRel, kind: "file", size: st.size });
        }
      }
    };
    walk(rootAbs, rootRel, 1);
    return Promise.resolve({
      ok: true,
      value: { entries, truncated },
      summaryForModel:
        entries
          .map((e) => (e.kind === "dir" ? `${e.path}/` : `${e.path} (${String(e.size ?? 0)} B)`))
          .join("\n") + (truncated ? "\n…[list truncated]" : ""),
    });
  },
};

// ---------------------------------------------------------------- fs.outline

const OutlineInput = z.object({ path: PathInput });
const OutlineOutput = z.object({
  path: z.string(),
  symbols: z.array(z.object({ kind: z.string(), name: z.string(), line: z.number().int() })),
});
const SYMBOL_RE =
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(function\*?|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/;

export const fsOutline: AgentTool<z.infer<typeof OutlineInput>, z.infer<typeof OutlineOutput>> = {
  id: "fs.outline",
  description:
    "Heuristic outline of top-level declarations (functions, classes, types, consts) in a JS/TS file with line numbers.",
  inputSchema: OutlineInput,
  outputSchema: OutlineOutput,
  permission: {
    capability: "fs.read",
    risk: "low",
    scope: (i) => i.path,
    defaultPolicy: "allow",
    describe: (i) => `Outline ${i.path}`,
  },
  timeoutMs: 5_000,
  mutates: false,
  execute(input, ctx) {
    const { relative, absolute } = resolveProjectPath(ctx.projectRoot, input.path);
    const env = guardEnv<z.infer<typeof OutlineOutput>>(relative);
    if (env) return Promise.resolve(env);
    if (!existsSync(absolute)) return Promise.resolve(fail("fs.not_found", `${relative} does not exist.`));
    const lines = readFileSync(absolute, "utf8").split("\n");
    const symbols: { kind: string; name: string; line: number }[] = [];
    lines.forEach((l, i) => {
      const m = SYMBOL_RE.exec(l);
      if (m?.[1] && m[2]) symbols.push({ kind: m[1].replace("*", ""), name: m[2], line: i + 1 });
    });
    return Promise.resolve({
      ok: true,
      value: { path: relative, symbols },
      summaryForModel:
        symbols.length > 0
          ? symbols.map((s) => `${String(s.line)}: ${s.kind} ${s.name}`).join("\n")
          : `${relative}: no top-level declarations found.`,
    });
  },
};

// ---------------------------------------------------------------- fs.write

const WriteInput = z.object({
  path: PathInput,
  content: z.string().max(2_000_000),
  /** Hash from fs.read; required when overwriting a file that was not read in this task. */
  expectedHash: z.string().optional(),
});
const WriteOutput = z.object({
  path: z.string(),
  hash: z.string(),
  created: z.boolean(),
  bytes: z.number().int(),
});

export const fsWrite: AgentTool<z.infer<typeof WriteInput>, z.infer<typeof WriteOutput>> = {
  id: "fs.write",
  description:
    "Create or fully overwrite a text file inside the project. Overwriting requires that the file was read in this task (or an expectedHash).",
  inputSchema: WriteInput,
  outputSchema: WriteOutput,
  permission: {
    capability: "fs.write",
    risk: "medium",
    scope: (i) => i.path,
    defaultPolicy: "ask",
    describe: (i) => `Write ${i.path} (${String(i.content.length)} chars)`,
  },
  timeoutMs: 10_000,
  mutates: true,
  execute(input, ctx) {
    const { relative, absolute } = resolveProjectPath(ctx.projectRoot, input.path, { forWrite: true });
    const env = guardEnv<z.infer<typeof WriteOutput>>(relative);
    if (env) return Promise.resolve(env);
    const conflict = checkWriteConflict<z.infer<typeof WriteOutput>>(
      ctx,
      relative,
      absolute,
      input.expectedHash,
    );
    if (conflict) return Promise.resolve(conflict);
    const created = !existsSync(absolute);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, input.content, "utf8");
    const hash = contentHash(input.content);
    ctx.ledger.recordRead(relative, hash);
    return Promise.resolve({
      ok: true,
      value: { path: relative, hash, created, bytes: Buffer.byteLength(input.content) },
      summaryForModel: `${created ? "Created" : "Updated"} ${relative} (hash ${hash}).`,
    });
  },
};

// ---------------------------------------------------------------- fs.patch

const PatchInput = z.object({
  path: PathInput,
  expectedHash: z.string().optional(),
  edits: z
    .array(
      z.object({
        /** Exact text to find; must occur exactly once unless `occurrence` is given. */
        find: z.string().min(1).max(100_000),
        replace: z.string().max(200_000),
        occurrence: z.number().int().min(1).optional(),
      }),
    )
    .min(1)
    .max(50),
});
const PatchOutput = z.object({ path: z.string(), hash: z.string(), applied: z.number().int() });

export function applyEdits(
  content: string,
  edits: z.infer<typeof PatchInput>["edits"],
): { content: string } | { error: string; index: number } {
  let out = content;
  for (const [i, e] of edits.entries()) {
    const positions: number[] = [];
    let from = 0;
    for (;;) {
      const idx = out.indexOf(e.find, from);
      if (idx < 0) break;
      positions.push(idx);
      from = idx + e.find.length;
      if (positions.length > 1000) break;
    }
    if (positions.length === 0) return { error: `edit ${String(i + 1)}: text not found`, index: i };
    if (e.occurrence === undefined && positions.length > 1)
      return {
        error: `edit ${String(i + 1)}: text occurs ${String(positions.length)} times; add "occurrence" or include more context`,
        index: i,
      };
    const at = positions[(e.occurrence ?? 1) - 1];
    if (at === undefined)
      return {
        error: `edit ${String(i + 1)}: occurrence ${String(e.occurrence ?? 1)} does not exist`,
        index: i,
      };
    out = out.slice(0, at) + e.replace + out.slice(at + e.find.length);
  }
  return { content: out };
}

export const fsPatch: AgentTool<z.infer<typeof PatchInput>, z.infer<typeof PatchOutput>> = {
  id: "fs.patch",
  description:
    "Apply exact search/replace edits to a file that was read in this task. Each `find` must match exactly once (or give `occurrence`). Atomic: all edits apply or none.",
  inputSchema: PatchInput,
  outputSchema: PatchOutput,
  permission: {
    capability: "fs.write",
    risk: "medium",
    scope: (i) => i.path,
    defaultPolicy: "ask",
    describe: (i) => `Edit ${i.path} (${String(i.edits.length)} change${i.edits.length === 1 ? "" : "s"})`,
  },
  timeoutMs: 10_000,
  mutates: true,
  execute(input, ctx) {
    const { relative, absolute } = resolveProjectPath(ctx.projectRoot, input.path, { forWrite: true });
    const env = guardEnv<z.infer<typeof PatchOutput>>(relative);
    if (env) return Promise.resolve(env);
    if (!existsSync(absolute))
      return Promise.resolve(fail("fs.not_found", `${relative} does not exist; use fs.write to create it.`));
    const conflict = checkWriteConflict<z.infer<typeof PatchOutput>>(
      ctx,
      relative,
      absolute,
      input.expectedHash,
    );
    if (conflict) return Promise.resolve(conflict);
    const current = readFileSync(absolute, "utf8");
    const result = applyEdits(current, input.edits);
    if ("error" in result)
      return Promise.resolve(
        fail("fs.patch_failed", `${relative}: ${result.error}. Nothing was changed.`, { edit: result.index }),
      );
    writeFileSync(absolute, result.content, "utf8");
    const hash = contentHash(result.content);
    ctx.ledger.recordRead(relative, hash);
    return Promise.resolve({
      ok: true,
      value: { path: relative, hash, applied: input.edits.length },
      summaryForModel: `Applied ${String(input.edits.length)} edit(s) to ${relative} (hash ${hash}).`,
    });
  },
};

// ---------------------------------------------------------------- fs.delete

const DeleteInput = z.object({ path: PathInput, recursive: z.boolean().default(false) });
const DeleteOutput = z.object({ path: z.string(), removed: z.number().int() });

export const fsDelete: AgentTool<z.infer<typeof DeleteInput>, z.infer<typeof DeleteOutput>> = {
  id: "fs.delete",
  description: "Delete a file, or a directory with recursive=true. Always requires user confirmation.",
  inputSchema: DeleteInput,
  outputSchema: DeleteOutput,
  permission: {
    capability: "fs.delete",
    risk: "destructive",
    scope: (i) => i.path,
    defaultPolicy: "ask",
    describe: (i) => `Delete ${i.path}${i.recursive ? " and everything inside it" : ""}`,
  },
  timeoutMs: 30_000,
  mutates: true,
  execute(input, ctx) {
    const { relative, absolute } = resolveProjectPath(ctx.projectRoot, input.path, { forWrite: true });
    if (!existsSync(absolute)) return Promise.resolve(fail("fs.not_found", `${relative} does not exist.`));
    const st = statSync(absolute);
    if (st.isDirectory() && !input.recursive)
      return Promise.resolve(
        fail("fs.is_directory", `${relative} is a directory; pass recursive=true to remove it.`),
      );
    let removed = 1;
    if (st.isDirectory()) removed = countFiles(absolute);
    rmSync(absolute, { recursive: input.recursive, force: false });
    ctx.ledger.forget(relative);
    return Promise.resolve({
      ok: true,
      value: { path: relative, removed },
      summaryForModel: `Deleted ${relative} (${String(removed)} file${removed === 1 ? "" : "s"}).`,
    });
  },
};

function countFiles(dir: string): number {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    n += statSync(p).isDirectory() ? countFiles(p) : 1;
  }
  return n;
}

// ---------------------------------------------------------------- fs.rename

const RenameInput = z.object({ from: PathInput, to: PathInput });
const RenameOutput = z.object({ from: z.string(), to: z.string() });

export const fsRename: AgentTool<z.infer<typeof RenameInput>, z.infer<typeof RenameOutput>> = {
  id: "fs.rename",
  description: "Move or rename a file or directory inside the project. Fails if the destination exists.",
  inputSchema: RenameInput,
  outputSchema: RenameOutput,
  permission: {
    capability: "fs.write",
    risk: "medium",
    scope: (i) => i.from,
    defaultPolicy: "ask",
    describe: (i) => `Move ${i.from} → ${i.to}`,
  },
  timeoutMs: 10_000,
  mutates: true,
  execute(input, ctx) {
    const from = resolveProjectPath(ctx.projectRoot, input.from, { forWrite: true });
    const to = resolveProjectPath(ctx.projectRoot, input.to, { forWrite: true });
    if (!existsSync(from.absolute))
      return Promise.resolve(fail("fs.not_found", `${from.relative} does not exist.`));
    if (existsSync(to.absolute)) return Promise.resolve(fail("fs.exists", `${to.relative} already exists.`));
    mkdirSync(path.dirname(to.absolute), { recursive: true });
    renameSync(from.absolute, to.absolute);
    const hash = ctx.ledger.lastReadHash(from.relative);
    ctx.ledger.forget(from.relative);
    if (hash !== undefined) ctx.ledger.recordRead(to.relative, hash);
    return Promise.resolve({
      ok: true,
      value: { from: from.relative, to: to.relative },
      summaryForModel: `Moved ${from.relative} → ${to.relative}.`,
    });
  },
};

export const FS_TOOLS = [fsRead, fsList, fsOutline, fsWrite, fsPatch, fsDelete, fsRename] as const;
