# Reverse-Engineering Report — Reference `dyad-sh/dyad` @ `39064d24` → AutoAPPZ

This report consolidates `docs/reference/*`, `docs/legal/*`, `docs/design/*` and `docs/product/*`. Each section links to the detailed document.

## 1. Executive summary
The reference is a mature (2,049 commits, 43 contributors, 17 months) local-first Electron AI app builder. Its open-source region is a ~170k-line main-process monolith around a contract-driven IPC layer, SQLite catalog, git-per-turn versioning, a child-process dev-server runtime with an injecting reverse proxy, and deep integrations (Supabase, Neon, Vercel, Coolify, GitHub, MCP). Its **agent runtime — the tool loop, tools and sub-agents — is in an FSL-licensed region that prohibits competing use**, and several "intelligent" behaviors run in a vendor cloud. The product model is strong (prompt-first, transparent tool cards, versions, live preview with fix affordances), while the architecture carries significant debt (no process/package boundaries, two agent generations, module-level concurrency invariants, secrets to the renderer, stdout-regex runtime). AutoAPPZ keeps the concepts, discards the couplings, and adds what the reference lacks: a persisted task lifecycle with validation/repair, requirements traceability, scoped permissions, a persistent context engine, a real runtime supervisor and portable generated apps.

## 2. Product model → `docs/reference/PRODUCT-REVERSE-ENGINEERING.md §1`
## 3. User flows → `…PRODUCT-REVERSE-ENGINEERING.md §2–3` (19 journeys traced)
## 4. Repository organization → `docs/reference/REPOSITORY-MAP.md`
## 5. Architecture → `docs/reference/ARCHITECTURE.md`
## 6. IPC/API → `docs/reference/IPC-CATALOG.md` (383 channels; findings §2)
## 7. Persistence → `docs/reference/DATABASE.md`
## 8. Agent system → `docs/reference/AGENT-RUNTIME.md`
## 9. Context engine → `docs/reference/CODE-INTELLIGENCE.md`
## 10. Code generation → `docs/reference/CODE-GENERATION-ENGINE.md`
## 11. Runtime → `docs/reference/RUNTIME-PREVIEW.md`
## 12. Git → `PRODUCT-REVERSE-ENGINEERING.md §2 (Git)`, `DATABASE.md §1.3`, `AGENT-RUNTIME.md §8`
## 13. Databases → `docs/reference/DATABASE.md §2`
## 14. Deployment → `PRODUCT-REVERSE-ENGINEERING.md §2 (Deployment)`, `IPC-CATALOG.md §1.12`
## 15. Security → `docs/reference/SECURITY-REVIEW.md` (findings S1–S10)
## 16. Testing → `docs/reference/TESTING.md`
## 17. UX → `docs/reference/UX-ANALYSIS.md`
## 18. Performance → `TECHNICAL-DEBT.md §2.4`; no published benchmarks in the reference; our methodology in `docs/performance/BENCHMARKS.md`
## 19. Technical debt → `docs/reference/TECHNICAL-DEBT.md`
## 20. Licensing boundaries → `docs/legal/REFERENCE-LICENSE-AUDIT.md` (Apache-2.0 outside `src/pro`; FSL inside; zero reuse)

## 21. Strong ideas worth retaining conceptually
1. Prompt-first onboarding with parked intent that survives provider setup.
2. Every AI turn is a git commit; undo and "restore to message" as product verbs; dirty-tree preservation before restores.
3. Contract-driven IPC with derived allowlists, envelopes carrying typed error kinds, trusted-frame checks, sandboxed preview popups.
4. Main-owned state machines with pure transitions, invocation refs, cancellation tombstones and co-simulation tests.
5. Per-app resource coordinator with declared read/write claims and deletion fences.
6. Live preview instrumentation (error/rejection/overlay capture, navigation bridge) feeding a "fix with AI" affordance; component selection to scope edits.
7. Consent machine unifying tool consent, MCP consent, questionnaires, integration prompts and review with deadlines.
8. Blueprint questionnaire before building; plan mode with annotations; todo tracking; sub-agent personas with scoped assignments and delimited reports.
9. Package-manager safety: minimum release age, build-script allowlists, npm firewall, spec grammar validation.
10. Deterministic fake-LLM server with a tool-call fixture DSL; hybrid renderer+IPC test harness; request-body snapshots.
11. Path safety utilities (safeJoin, realpath containment, project-root refusal, symlink handling) and dotenv redaction.
12. Structured `DyadError`-style kinds to keep telemetry clean; crash sentinel and performance snapshots for diagnostics.

## 22. Ideas that should not be carried forward
1. XML pseudo-tool protocol and stored-response migration debt.
2. Chat "modes" (Build/Ask/Plan/Agent) as the primary control; legacy Build mode retained for provider limits.
3. Secrets decrypted into the renderer; unvalidated legacy handlers; args logging.
4. `install && dev` shell strings, stdout-regex readiness, killing foreign processes on the app port.
5. Integration-per-column `apps` schema; provider concepts leaking into prompts and three UI locations.
6. Vendor-cloud entitlement gating woven through core logic (smart context, sub-agents, edits).
7. Copying imported repositories into a managed folder by default; vendor devDependencies in generated apps; nine injected preview scripts.
8. Module-level maps with hand-written "no await here" invariants; 3k-line handlers; flat utils namespace.
9. Snapshot-heavy E2E as the primary safety net with agent flows skipped on Windows and no Linux.
10. Per-tool-name "always allow" permissions without scope.

## 23. Proposed replacement architecture → `docs/design/SYSTEM-ARCHITECTURE.md`, `AGENT-ARCHITECTURE.md`, `CONTEXT-ENGINE.md`, `THREAT-MODEL.md`, ADRs 000–011
## 24. Measurable improvement targets → `docs/product/REFERENCE-VS-OURS.md`, `docs/product/PRODUCT.md §5`, `docs/performance/BENCHMARKS.md`
## 25. Implementation roadmap → `IMPLEMENTATION-PLAN.md` (M0–M14), `docs/product/ROADMAP.md`

## Self-critique (Phase 47)
- **Assumptions:** FSL tool behavior inferred from prompts/rules; engine-side behaviors unknown; local model capability metadata absent — all marked `UNVERIFIED`.
- **Unverified:** CSP absence, community template API, local Supabase flow, network-failure surfacing, checksum verification of managed Node downloads.
- **Copying risk:** our contract/command-bus and state-machine concepts resemble the reference's *patterns* (industry-standard); implementation is independent and differs in envelope, secrets policy, validation and transport abstraction.
- **Simplifications made:** fewer packages than proposed; one agent instead of modes; no cloud sandbox/remote machines in v1.
- **State corruption/data loss risks to watch:** checkpoint capture on very large dirty trees; index/DB migrations; task journal replay; runtime kill on Windows.
- **Secret leak risks:** logs, error messages, prompts — addressed by references + redaction middleware + tests.
- **Unexpected agent actions:** scoped permissions, read-before-write, bounded loops, audit.
- **Untested subsystems (to be addressed in M0–M14):** everything; the plan makes tests part of every milestone.
- **Abstractions without need:** plugin loader and semantic retrieval are deferred behind interfaces until a consumer exists.
- **Understandability:** a new engineer should read `docs/architecture/OVERVIEW.md` → ADRs → package READMEs.
