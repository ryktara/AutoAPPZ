export type SqlKind = "read" | "write" | "ddl" | "destructive" | "unknown";

export interface SqlClassification {
  readonly kind: SqlKind;
  /** Number of top-level statements found. */
  readonly statements: number;
  /** Human explanation of the most severe statement. */
  readonly reason: string;
}

const SEVERITY: Record<SqlKind, number> = { read: 0, unknown: 1, write: 2, ddl: 3, destructive: 4 };

/**
 * Conservative static classification of SQL for the permission engine. Comments and string literals
 * are blanked before matching, statements are split on top-level semicolons, and the most severe
 * statement wins. Anything unrecognised is "unknown" (treated like a write by callers).
 */
export function classifySql(sql: string): SqlClassification {
  const statements = splitStatements(blank(sql));
  if (statements.length === 0) return { kind: "unknown", statements: 0, reason: "empty statement" };
  let worst: { kind: SqlKind; reason: string } = { kind: "read", reason: "read-only query" };
  for (const s of statements) {
    const c = classifyOne(s);
    if (SEVERITY[c.kind] > SEVERITY[worst.kind]) worst = c;
  }
  return { kind: worst.kind, statements: statements.length, reason: worst.reason };
}

function classifyOne(statement: string): { kind: SqlKind; reason: string } {
  const s = statement.trim().replace(/\s+/g, " ");
  const upper = s.toUpperCase();
  const head = leadingKeyword(upper);
  switch (head) {
    case "SELECT":
    case "VALUES":
    case "TABLE":
    case "SHOW":
    case "EXPLAIN":
      if (/\bINTO\s+(?!TEMP|TEMPORARY)\w/.test(upper) && head === "SELECT")
        return { kind: "ddl", reason: "SELECT INTO creates a table" };
      if (
        head === "EXPLAIN" &&
        /\bANALY[SZ]E\b/.test(upper) &&
        !/\bEXPLAIN\s+(\(.*\)\s*)?(ANALY[SZ]E\s+)?SELECT\b/.test(upper)
      )
        return { kind: "write", reason: "EXPLAIN ANALYZE executes the statement" };
      return { kind: "read", reason: "read-only query" };
    case "WITH": {
      // CTE: the final statement and any data-modifying CTE body both count; the worst wins.
      const finalStart = lastTopLevelStatementStart(upper);
      const prefix = upper.slice(0, finalStart);
      const final = classifyOne(upper.slice(finalStart) || "SELECT 1");
      let worst = final;
      for (const m of prefix.matchAll(/\b(INSERT|UPDATE|DELETE|MERGE)\b/g)) {
        const rest = prefix.slice(m.index);
        const body = rest.slice(0, rest.search(/\)\s*(,|$)/) < 0 ? rest.length : rest.search(/\)\s*(,|$)/));
        const inner = classifyOne(body);
        if (SEVERITY[inner.kind] > SEVERITY[worst.kind])
          worst = { kind: inner.kind, reason: `data-modifying CTE: ${inner.reason}` };
      }
      return worst;
    }
    case "INSERT":
    case "MERGE":
    case "COPY":
      return { kind: "write", reason: `${head} modifies data` };
    case "UPDATE":
      return /\bWHERE\b/.test(upper)
        ? { kind: "write", reason: "UPDATE with WHERE" }
        : { kind: "destructive", reason: "UPDATE without WHERE affects every row" };
    case "DELETE":
      return /\bWHERE\b/.test(upper)
        ? { kind: "write", reason: "DELETE with WHERE" }
        : { kind: "destructive", reason: "DELETE without WHERE removes every row" };
    case "TRUNCATE":
      return { kind: "destructive", reason: "TRUNCATE removes every row" };
    case "DROP":
      return { kind: "destructive", reason: "DROP removes a database object" };
    case "ALTER":
      if (/\bDROP\b/.test(upper))
        return { kind: "destructive", reason: "ALTER ... DROP removes a column or constraint" };
      if (/\b(RENAME|TYPE)\b/.test(upper))
        return {
          kind: "ddl",
          reason: "ALTER changes a schema definition (rename/type change may break readers)",
        };
      return { kind: "ddl", reason: "ALTER changes the schema" };
    case "CREATE":
      return /\bOR REPLACE\b/.test(upper)
        ? { kind: "ddl", reason: "CREATE OR REPLACE overwrites a definition" }
        : { kind: "ddl", reason: "CREATE adds a schema object" };
    case "GRANT":
    case "REVOKE":
    case "REINDEX":
    case "VACUUM":
    case "ANALYZE":
    case "CLUSTER":
      return { kind: "ddl", reason: `${head} changes database administration state` };
    case "BEGIN":
    case "START":
    case "COMMIT":
    case "END":
    case "ROLLBACK":
    case "SAVEPOINT":
    case "RELEASE":
      return { kind: "read", reason: "transaction control" };
    case "SET":
    case "RESET":
      return { kind: "read", reason: "session setting" };
    case "DO":
    case "CALL":
    case "EXECUTE":
    case "PREPARE":
      return { kind: "unknown", reason: `${head} runs arbitrary code` };
    default:
      return { kind: "unknown", reason: `unrecognised statement "${s.slice(0, 30)}"` };
  }
}

function leadingKeyword(upper: string): string {
  const m = /^\(*\s*([A-Z]+)/.exec(upper);
  return m?.[1] ?? "";
}

/** Blanks comments and string literals so keywords inside them never match. */
export function blank(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    const ch = sql[i] ?? "";
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      out += "''";
      i = j + 1;
      continue;
    }
    if (ch === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        out += "''";
        i = close < 0 ? sql.length : close + tag[0].length;
        continue;
      }
    }
    if (ch === '"') {
      const j = sql.indexOf('"', i + 1);
      out += sql.slice(i, j < 0 ? sql.length : j + 1);
      i = j < 0 ? sql.length : j + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function splitStatements(blanked: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of blanked) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) {
      if (current.trim()) parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Index where the statement after the CTE list begins (first top-level SELECT/INSERT/UPDATE/DELETE/MERGE). */
function lastTopLevelStatementStart(upper: string): number {
  let depth = 0;
  for (let i = 0; i < upper.length; i++) {
    const ch = upper[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && i > 4) {
      const rest = upper.slice(i);
      if (/^(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/.test(rest) && /[\s)]/.test(upper[i - 1] ?? " ")) return i;
    }
  }
  return upper.length;
}
