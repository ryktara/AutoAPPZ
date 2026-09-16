# Platform Database (`packages/storage`)

SQLite (`better-sqlite3`, WAL, foreign keys) + Drizzle ORM; hand-written SQL migrations in `packages/storage/src/migrations` tracked in `_migrations(id, applied_at)`; startup performs backup (`<dataDir>/backups/`) → migrate → verify (`integrity_check`, `foreign_key_check`); failure restores the backup and surfaces a startup error. A test asserts the Drizzle schema and the migrated database agree table-by-table and column-by-column.

## Schema (initial)
| Table | Columns (abridged) |
|---|---|
| `settings` | `key PK, value(json), updatedAt` |
| `secret_refs` | `id PK, kind, provider, label, lastFour, createdAt, rotatedAt` (values live in the OS keychain) |
| `projects` | `id PK, name, path, origin(created\|imported\|copied), templateId, runtimeProfile, createdAt, lastOpenedAt, archivedAt` |
| `integrations` | `id PK, projectId FK, kind(database\|deployment\|vcs\|mcp), adapterId, config(json), status, updatedAt` |
| `blueprints` | `id PK, projectId FK, version, document(json/yaml), approvedAt, derivedFromTaskId` |
| `requirements` | `id PK (REQ-nnn), projectId, blueprintItemRef, title, status` |
| `acceptance_criteria` | `id PK, requirementId FK, text, status, evidence(json)` |
| `sessions` | `id PK, projectId FK, title, createdAt, lastActiveAt` |
| `messages` | `id PK, sessionId FK, role, content, taskId?, createdAt` |
| `tasks` | `id PK, projectId, sessionId, request, complexity, state, plan(json), checkpointId?, cost(json), createdAt, updatedAt, terminalAt` |
| `task_events` | `taskId FK, seq, fromState, toState, event, payload(json), at` (append-only) |
| `agent_runs` | `id PK, taskId, role, provider, model, tokens, cost, startedAt, endedAt, status` |
| `tool_calls` | `id PK, taskId, agentRunId, toolId, capability, scope(json), decision, decisionSource, inputRedacted(json), resultSummary, durationMs, at` (audit, append-only) |
| `checkpoints` | `id PK, taskId, projectId, headBefore, baseSnapshotRef, resultCommit?, createdAt` |
| `project_memory` | `id PK, projectId, category, statement, provenanceTaskId, confidence, createdAt, supersededBy?` |
| `usage_records` | `id PK, taskId?, provider, model, inputTokens, outputTokens, estimatedCost, at` |
| `permissions` | `id PK, projectId?, capability, scopePattern, decision, lifetime, createdAt, expiresAt?` |
| `index_status` | `projectId PK, state, files, indexed, lastFullAt, lastIncrementalAt, error` |

## Rules
- No secrets in any column; `secret_refs` only.
- Append-only tables never updated in place; retention jobs prune by policy.
- Every migration ships with an upgrade test from the previous release's fixture DB.
- Project-scoped queries always filter by `projectId`; repositories enforce it.
