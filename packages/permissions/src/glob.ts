/**
 * Minimal glob matcher for scope patterns. Supports `**` (any depth, including zero segments),
 * `*` (within a segment), `?` (one char) and literal text. Separators are always `/`.
 * Deliberately dependency-free and side-effect-free so it can be property-tested exhaustively.
 */
export function globToRegExp(pattern: string): RegExp {
  let re = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern.charAt(i);
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` matches zero or more whole segments; a trailing `**` matches the rest.
        if (pattern[i + 2] === "/") {
          re += "(?:[^/]+/)*";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`${re}$`);
}

const cache = new Map<string, RegExp>();

export function globMatch(pattern: string, value: string): boolean {
  let re = cache.get(pattern);
  if (!re) {
    re = globToRegExp(pattern);
    cache.set(pattern, re);
  }
  return re.test(value);
}

/**
 * Specificity for "most specific policy wins": more literal characters and fewer wildcards rank higher.
 * A plain literal outranks any glob; `src/**` outranks `**`.
 */
export function patternSpecificity(pattern: string): number {
  const literal = pattern.replace(/[*?]/g, "").length;
  const wildcards =
    (pattern.match(/\*\*/g) ?? []).length * 10 +
    (pattern.match(/(?<!\*)\*(?!\*)/g) ?? []).length * 3 +
    (pattern.match(/\?/g) ?? []).length;
  return literal * 100 - wildcards;
}
