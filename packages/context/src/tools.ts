import { z } from "zod";
import type { AgentTool, AnyTool, ToolResult } from "@autoappz/tools";
import type { ContextEngine } from "./engine.ts";
import { renderOutline } from "./retrieval.ts";

const SearchCodeInput = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe("Natural-language or identifier query; terms are matched loosely."),
  path: z.string().max(1024).optional().describe("Restrict to a project-relative directory."),
  limit: z.number().int().min(1).max(50).default(12),
});
const SearchCodeOutput = z.object({
  hits: z.array(
    z.object({
      path: z.string(),
      startLine: z.number().int(),
      endLine: z.number().int(),
      kind: z.string(),
      score: z.number(),
      snippet: z.string(),
    }),
  ),
  indexed: z.boolean(),
});
const FindSymbolInput = z.object({
  name: z.string().min(1).max(200),
  kind: z
    .enum(["function", "class", "interface", "type", "enum", "variable", "component", "section", "rule"])
    .optional(),
  path: z.string().max(1024).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
const FindSymbolOutput = z.object({
  symbols: z.array(
    z.object({
      path: z.string(),
      name: z.string(),
      kind: z.string(),
      startLine: z.number().int(),
      endLine: z.number().int(),
      exported: z.boolean(),
      signature: z.string(),
    }),
  ),
});
const WhoImportsInput = z.object({ path: z.string().min(1).max(1024) });
const WhoImportsOutput = z.object({ importers: z.array(z.string()), imports: z.array(z.string()) });
const OutlineInput = z.object({ path: z.string().min(1).max(1024) });
const OutlineOutput = z.object({ outline: z.string(), symbols: z.number().int() });

type SearchCodeIn = z.infer<typeof SearchCodeInput>;
type SearchCodeOut = z.infer<typeof SearchCodeOutput>;
type FindSymbolIn = z.infer<typeof FindSymbolInput>;
type FindSymbolOut = z.infer<typeof FindSymbolOutput>;
type WhoImportsIn = z.infer<typeof WhoImportsInput>;
type WhoImportsOut = z.infer<typeof WhoImportsOutput>;
type OutlineIn = z.infer<typeof OutlineInput>;
type OutlineOut = z.infer<typeof OutlineOutput>;

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");

/** Agent tools backed by the index: ranked code search, symbol lookup, import graph, file outline. */
export function createContextTools(engine: ContextEngine): AnyTool[] {
  const searchCode: AgentTool<SearchCodeIn, SearchCodeOut> = {
    id: "search.code",
    description:
      "Ranked search over the indexed project (identifiers, prose and paths). Prefer this over search.text for finding where something is implemented.",
    inputSchema: SearchCodeInput,
    outputSchema: SearchCodeOutput,
    permission: {
      capability: "fs.read",
      risk: "low",
      scope: (i) => (i.path ? `${norm(i.path)}/**` : "**"),
      defaultPolicy: "allow",
      describe: (i) => `Search code for "${i.query}"`,
    },
    timeoutMs: 10_000,
    mutates: false,
    execute(input, ctx) {
      const index = engine.open(ctx.projectId, ctx.projectRoot);
      const ready = index.status().state === "ready";
      const hits = index
        .search(input.query, { limit: input.limit, pathPrefix: input.path ? norm(input.path) : undefined })
        .map((h) => ({
          path: h.path,
          startLine: h.startLine,
          endLine: h.endLine,
          kind: h.kind,
          score: Number(h.score.toFixed(2)),
          snippet: h.text.split("\n").slice(0, 6).join("\n").slice(0, 400),
        }));
      const summary =
        hits.length === 0
          ? `No indexed matches for "${input.query}"${ready ? "" : " (index not ready yet; try search.text)"}.`
          : hits
              .map((h) => `${h.path}:${String(h.startLine)}-${String(h.endLine)} (${h.kind})\n${h.snippet}`)
              .join("\n---\n");
      return Promise.resolve({ ok: true, value: { hits, indexed: ready }, summaryForModel: summary });
    },
  };

  const findSymbol: AgentTool<FindSymbolIn, FindSymbolOut> = {
    id: "code.findSymbol",
    description: "Find where a function, class, type, component or other symbol is declared.",
    inputSchema: FindSymbolInput,
    outputSchema: FindSymbolOutput,
    permission: {
      capability: "fs.read",
      risk: "low",
      scope: () => "**",
      defaultPolicy: "allow",
      describe: (i) => `Find symbol ${i.name}`,
    },
    timeoutMs: 10_000,
    mutates: false,
    execute(input, ctx) {
      const index = engine.open(ctx.projectId, ctx.projectRoot);
      const symbols = index
        .symbols({
          name: input.name,
          kind: input.kind,
          path: input.path ? norm(input.path) : undefined,
          limit: input.limit,
        })
        .map((s) => ({
          path: s.path,
          name: s.name,
          kind: s.kind,
          startLine: s.startLine,
          endLine: s.endLine,
          exported: s.exported,
          signature: s.signature,
        }));
      const summary =
        symbols.length === 0
          ? `No symbol matching "${input.name}".`
          : symbols
              .map(
                (s) =>
                  `${s.path}:${String(s.startLine)} ${s.exported ? "export " : ""}${s.kind} ${s.name} — ${s.signature}`,
              )
              .join("\n");
      return Promise.resolve({ ok: true, value: { symbols }, summaryForModel: summary });
    },
  };

  const whoImports: AgentTool<WhoImportsIn, WhoImportsOut> = {
    id: "code.whoImports",
    description: "List files that import a given file, and the project files it imports.",
    inputSchema: WhoImportsInput,
    outputSchema: WhoImportsOutput,
    permission: {
      capability: "fs.read",
      risk: "low",
      scope: (i) => norm(i.path),
      defaultPolicy: "allow",
      describe: (i) => `Who imports ${i.path}`,
    },
    timeoutMs: 10_000,
    mutates: false,
    execute(input, ctx): Promise<ToolResult<WhoImportsOut>> {
      const index = engine.open(ctx.projectId, ctx.projectRoot);
      const p = norm(input.path);
      if (!index.hasFile(p))
        return Promise.resolve({
          ok: false,
          error: { code: "context.unknown_file", message: `${p} is not in the index.` },
          summaryForModel: `${p} is not in the index.`,
        });
      const importers = index.importers(p);
      const imports = index.importsOf(p);
      const summary = `${p}\nimported by (${String(importers.length)}): ${importers.join(", ") || "-"}\nimports (${String(imports.length)}): ${imports.join(", ") || "-"}`;
      return Promise.resolve({ ok: true, value: { importers, imports }, summaryForModel: summary });
    },
  };

  const outline: AgentTool<OutlineIn, OutlineOut> = {
    id: "code.outline",
    description:
      "Symbols declared in a file with line numbers and signatures (cheaper than reading the file).",
    inputSchema: OutlineInput,
    outputSchema: OutlineOutput,
    permission: {
      capability: "fs.read",
      risk: "low",
      scope: (i) => norm(i.path),
      defaultPolicy: "allow",
      describe: (i) => `Outline ${i.path}`,
    },
    timeoutMs: 10_000,
    mutates: false,
    execute(input, ctx): Promise<ToolResult<OutlineOut>> {
      const index = engine.open(ctx.projectId, ctx.projectRoot);
      const p = norm(input.path);
      if (!index.hasFile(p))
        return Promise.resolve({
          ok: false,
          error: { code: "context.unknown_file", message: `${p} is not in the index.` },
          summaryForModel: `${p} is not in the index.`,
        });
      const symbols = index.outline(p);
      const text = symbols.length > 0 ? renderOutline(symbols) : "(no symbols recognised)";
      return Promise.resolve({
        ok: true,
        value: { outline: text, symbols: symbols.length },
        summaryForModel: `${p}\n${text}`,
      });
    },
  };

  return [searchCode, findSymbol, whoImports, outline];
}
