# @autoappz/contracts

Zod schemas and TypeScript types for every command, query, event, stream and DTO. This is the **only** package the renderer shares with the main process. It is a leaf: it imports no other `@autoappz/*` package and nothing from Node or Electron.

- `definitions.ts` — `defineCommand/defineQuery/defineEvent/defineStream`
- `errors.ts` — `AppError` with typed `kind`
- `envelope.ts` — request/response/stream/event wire schemas
- `common.ts` — `SecretRef`, ids, `ProjectRelativePath`, `TokenBudget`
- `domains/*` — one file per domain; `registry.ts` lists every contract

Rule: secret values never appear in contracts (test-enforced); use `SecretRef`.
