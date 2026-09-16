import { readFileSync } from "node:fs";
import "./helper.mjs";

export function activate() {
  readFileSync("/etc/passwd");
}
