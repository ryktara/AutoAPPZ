#!/usr/bin/env node
// Clean-room guard (docs/legal/REFERENCE-LICENSE-AUDIT.md §8).
// Fails if identifiers, tag vocabularies, protocol schemes or package names of the
// reference product appear anywhere outside the analysis folders.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const ALLOWED_DIRS = new Set(["docs/reference", "docs/legal", "_reference", "node_modules", ".git"]);
const ALLOWED_FILES = new Set([
  "REVERSE-ENGINEERING-REPORT.md",
  "tools/check-clean-room.mjs",
  "docs/adr/ADR-000-license-and-clean-room.md",
  "docs/product/REFERENCE-VS-OURS.md",
]);
// The reference product's name and derived identifiers. Kept as fragments so this
// file itself does not spell them out more than necessary.
const NAME = ["dy", "ad"].join("");
const PATTERNS = [
  new RegExp(`\\b${NAME}\\b`, "i"),
  new RegExp(`<${NAME}-`, "i"),
  new RegExp(`${NAME}://`, "i"),
  new RegExp(`@${NAME}-sh/`, "i"),
  new RegExp(`${NAME}\\.sh`, "i"),
];

let violations = 0;
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full).split(sep).join("/");
    if ([...ALLOWED_DIRS].some((d) => rel === d || rel.startsWith(`${d}/`))) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
      continue;
    }
    if (ALLOWED_FILES.has(rel)) continue;
    if (/\.(png|jpg|jpeg|gif|ico|icns|wasm|zip|lock|lockb)$/i.test(rel) || rel === "pnpm-lock.yaml") continue;
    let text;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const p of PATTERNS) {
        if (p.test(line)) {
          violations++;
          console.error(`${rel}:${i + 1}: reference identifier found: ${line.trim().slice(0, 120)}`);
          break;
        }
      }
    });
  }
}

walk(ROOT);
if (violations > 0) {
  console.error(`\nclean-room check failed with ${violations} violation(s).`);
  process.exit(1);
}
console.log("clean-room check passed.");
