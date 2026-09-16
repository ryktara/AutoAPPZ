# @autoappz/tools

Tool SDK and built-in tools (`docs/design/SYSTEM-ARCHITECTURE.md` §5).

- `ToolRuntime.execute()` — validate input → resolve scope → permission decision (may park for consent) → execute with timeout + signal → bound and redact `summaryForModel` → audit. Every call, including denials and invalid input, produces an audit row. Mutating tools are serialised per project.
- Path policy (`resolveProjectPath`) — relative only; no `..`, drives, UNC or `~`; realpath containment rejects symlinks escaping the project; `.git/` is never writable; `.env*` files are never readable through these tools.
- Read-before-write and optimistic concurrency via `ReadLedger` + content hashes: `fs.write`/`fs.patch` refuse files not read in this task and detect changes since the read.
- Tools: `fs.read`, `fs.list`, `fs.outline` (heuristic), `fs.write`, `fs.patch` (exact, atomic search/replace), `fs.delete` (destructive → always asks), `fs.rename`, `search.text` (ripgrep with a Node fallback).
