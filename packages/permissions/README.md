# @autoappz/permissions

Permission engine (ADR-006, `docs/security/PERMISSIONS.md`).

- `PermissionEngine.check()` — explicit deny wins → most specific project policy → session policy → once policy (consumed) → tool default → park for consent with a deadline (cancellable via the task signal). Destructive actions never auto-allow, even with a blanket rule.
- Consent choices become standing rules: `allow_project` persists via the `PolicyStore`; `allow_session` lives in memory; paths widen to the containing directory (`src/a/b.ts` → `src/a/**`).
- `globMatch` / `patternSpecificity` — dependency-free glob matching for scope patterns (`**`, `*`, `?`), property-tested.
