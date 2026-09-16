# Permissions

Canonical decision: `docs/adr/ADR-006-tool-permission-model.md`; threat context: `docs/design/THREAT-MODEL.md`.

## Model
`Policy { projectId?: string; capability: Capability; scopePattern: string; decision: "allow"|"deny"; lifetime: "once"|"session"|"project"; createdAt; expiresAt? }`

Capabilities: `fs.read, fs.write, fs.delete, shell.exec, net.fetch, git.write, git.remote, db.query, db.mutate, deploy, mcp.call, process.control, secrets.use`.

Risk tiers: `low` (read within project), `medium` (write within project, run project scripts), `high` (network to new hosts, git remote push, db mutate), `destructive` (delete many files, drop tables, force operations — never auto-allowed).

## Decision procedure
1. Resolve scope from tool input (e.g. `fs.write:src/**`).
2. Find the most specific matching policy (`project` > `session` > `once` consumed on use); explicit `deny` wins.
3. No policy → default from the tool descriptor (`ask` for medium+, `allow` for low reads inside the project).
4. `ask` parks the tool call with a deadline (5 min) and a consent sheet showing capability, scope, risk and effect preview; cancellation of the task releases the park.
5. Every decision and its provenance is written to `tool_calls`.

## UI
Consent sheet with: what will happen, where (paths/hosts/tables), why (task step), choices (Allow once / this session / this project / Deny). Project settings show all standing policies with revoke.

## Implementation (M5)

`packages/permissions` (`PermissionEngine`, glob scope matching) and `packages/tools` (`ToolRuntime` pipeline, path policy, read ledger). Project-lifetime rules are stored in the `permissions` table; session/once rules are in memory. Consent requests reach the renderer as `permissions.consentRequested` events and are answered with `permissions.respond`; the sheet lists tool, scope, risk tier and effect and offers Allow once / this session / this project (hidden for destructive actions) / Deny. Standing rules are listed per project with revoke. Audit rows live in `tool_calls` and are exposed through `tools.audit`.
