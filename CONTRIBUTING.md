# Contributing

## Ground rules
- Read `docs/architecture/OVERVIEW.md` and the relevant ADRs before changing a subsystem.
- Clean-room policy (`docs/legal/REFERENCE-LICENSE-AUDIT.md`) is binding: never copy code, prompts, fixtures, assets or naming from other products; `_reference/` is analysis-only and git-ignored.
- Every change follows the per-task procedure in `IMPLEMENTATION-PLAN.md` (criteria → tests → implement → typecheck → lint → integration → diff review → docs).
- TypeScript strict; no `any`/`@ts-ignore` without a justification comment; no lowering of lint/tsconfig strictness; no disabling tests to pass CI.
- Business logic lives in packages, not React components; the renderer never touches Node/fs/processes/git/secrets.

## Workflow
1. Open an issue or pick one; discuss consequential design in an ADR PR first.
2. Branch from `main`; conventional commits; add a changeset for user-visible changes.
3. `pnpm check` locally; CI must be green on all platforms.
4. PR template asks: which acceptance criteria, which tests, which docs.

## Developer Certificate of Origin
Sign off commits (`git commit -s`). No CLA.
