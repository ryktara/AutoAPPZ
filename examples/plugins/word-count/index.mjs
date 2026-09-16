// Sample AutoAPPZ plugin. It receives a narrow context and registers one tool.
// Plugins cannot import electron, fs, child_process or networking modules; the loader refuses them.

const schema = {
  safeParse(input) {
    return input && typeof input === "object" && typeof input.text === "string"
      ? { success: true, data: input }
      : { success: false, error: { issues: [{ path: ["text"], message: "text is required" }] } };
  },
};

export function activate(ctx) {
  ctx.tools.register({
    id: "word-count.count",
    description: "Count words, lines and characters in a piece of text.",
    inputSchema: schema,
    inputJsonSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to analyse" } },
      required: ["text"],
    },
    outputSchema: { safeParse: (value) => ({ success: true, data: value }) },
    permission: {
      capability: "fs.read",
      risk: "low",
      scope: () => "text",
      defaultPolicy: "allow",
      describe: () => "Count words",
    },
    timeoutMs: 5_000,
    mutates: false,
    execute(input) {
      const text = String(input.text);
      const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
      const lines = text.length === 0 ? 0 : text.split(/\r?\n/).length;
      const value = { words, lines, characters: text.length };
      return Promise.resolve({
        ok: true,
        value,
        summaryForModel: `${words} word(s), ${lines} line(s), ${text.length} character(s)`,
      });
    },
  });
  ctx.log.info("word-count activated");
}
