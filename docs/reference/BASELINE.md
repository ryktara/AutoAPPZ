# Reference Baseline — `dyad-sh/dyad`

Every reverse-engineering document under `docs/reference/` describes **this exact snapshot**. If the snapshot changes, this file is updated first and all dependent documents are re-verified.

Legal boundary: see [`docs/legal/REFERENCE-LICENSE-AUDIT.md`](../legal/REFERENCE-LICENSE-AUDIT.md). Nothing in this document describes `src/pro/` internals.

---

## 1. Snapshot identity

| Field | Value | Evidence |
|-------|-------|----------|
| Repository | `https://github.com/dyad-sh/dyad` | `package.json#repository` |
| Commit SHA | `39064d24b4df09055cfd4f109cd4da647a290fd1` | `git rev-parse HEAD` |
| Branch | `main` | `git rev-parse --abbrev-ref HEAD` |
| Commit date | 2026-09-16T08:23:44+01:00 | `git log -1 --format=%cI` |
| Version | `1.16.0-beta.1` | `package.json#version`; latest tag `v1.16.0-beta.1`; latest stable tag `v1.15.0` |
| Local clone location | `_reference/dyad/` (git-ignored) | `.gitignore` |
| History size | 2,049 commits; 43 contributors; first commit 2025-04-11; 522 commits in the 90 days before the snapshot | `git rev-list --count`, `git shortlog -sn --all` |
| Codebase size | `src/`: 2,178 files, ~524,000 TS/TSX lines (incl. tests); `src/pro/`: 172 files, ~58,750 lines (restricted) | `find`/`wc` (see REPOSITORY-MAP) |

---

## 2. Toolchain

| Concern | Value | Evidence |
|---------|-------|----------|
| Node.js | `>=24 <26` required (`engine-strict=true`); `mise.toml` pins `node = "24"`; CI uses `v24.13.1` | `package.json#engines`, `.npmrc`, `mise.toml`, `.github/workflows/ci.yml` |
| Package manager (app) | **npm** with `package-lock.json`; CI pins `npm@11.8.0` | `package-lock.json`, `ci.yml` |
| Package manager (generated apps / scaffold) | **pnpm** (`scaffold/pnpm-lock.yaml`; CI installs pnpm `10.33.2`) | `scaffold/`, `ci.yml` |
| TypeScript | `typescript@6.0.3` (devDep); type-checking via **tsgo** (`@typescript/native-preview@7.0.0-dev.*`) for the app (`npm run ts:main`), classic `tsc` for the two workers. `@typescript/typescript6@6.0.2` is a *runtime* dependency (used by the code-explorer worker; marked external in its Vite config). | `package.json#scripts.ts*`, `vite.code-explorer-worker.config.mts` |
| Formatter / linter | **oxfmt** `0.26` / **oxlint** `1.41`. ESLint 8 + `@typescript-eslint` 5 remain installed but `AGENTS.md` forbids invoking them. `@biomejs/biome@1.9.4` is a runtime dependency (usage UNVERIFIED — likely formats generated code; to be traced in Phase 5). | `package.json`, `AGENTS.md` |
| Pre-commit | husky + lint-staged | `.husky/`, `lint-staged.config.js` |

---

## 3. Framework versions (runtime)

| Layer | Library | Version |
|-------|---------|---------|
| Desktop shell | Electron | **40.0.0** (exact pin) |
| Packaging | Electron Forge | 7.11.1 (`plugin-vite`, `plugin-fuses`, `plugin-auto-unpack-natives`, makers squirrel/zip/deb/rpm + custom AppImage maker in `makers/`) |
| Bundler | Vite | ^5.4.17 |
| UI | React / React DOM | ^19.2.4, compiled with **React Compiler** (`babel-plugin-react-compiler@1.0.0`) |
| Routing | TanStack Router | ^1.114 |
| Server state | TanStack Query | ^5.75 |
| Client state | Jotai | ^2.12 |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`), `tw-animate-css`, `class-variance-authority`, `tailwind-merge` | — |
| Headless UI | `@base-ui/react` ^1.2 (Radix explicitly forbidden by `AGENTS.md`) | — |
| Editor | Monaco (`@monaco-editor/react` 4.7, `monaco-editor` 0.52) | — |
| Terminal | `@xterm/xterm` 6 + addons; `node-pty` 1.1 (native) | — |
| Rich text input | Lexical 0.33 + `lexical-beautiful-mentions` | — |
| Markdown/code display | `react-markdown`, `remark-gfm`, `shiki`/`react-shiki` | — |
| Canvas (annotator) | Konva / react-konva | — |
| i18n | i18next / react-i18next (locales: en, pt-BR, zh-CN per `PRODUCT.md`) | — |
| Validation | **Zod 4** (`^4.3.6`) | — |
| AI | Vercel **AI SDK `ai@^6.0.68`** with providers: `@ai-sdk/openai`, `anthropic`, `google`, `google-vertex`, `azure`, `amazon-bedrock`, `xai`, `openai-compatible`, `@ai-sdk/mcp`; `@modelcontextprotocol/sdk` ^1.17.5 | — |
| Persistence | `better-sqlite3` ^12.6 (native) + **Drizzle ORM** ^0.41 / `drizzle-kit` ^0.30.6 | — |
| Git | **dugite** ^3.0 (bundles a git binary; shipped as `extraResource`) | — |
| Search | `@vscode/ripgrep` ^1.17 (shipped as `extraResource`) | — |
| Remote machines | `ssh2` ^1.17 (pure-JS fallback, native helpers excluded) | — |
| Sandboxed scripting | `mustardscript` ^0.2.1 (native, unpacked from asar) | — |
| Secrets | Electron `safeStorage` + macOS native `dyad-keychain-reader` (`native/keychain-reader`, optionalDependency) | — |
| Telemetry | `posthog-js` | — |
| Logging | `electron-log` 5 | — |
| Auto-update | `update-electron-app` 3.1 (Squirrel/GitHub releases) | — |
| DB tooling (user apps) | `@neondatabase/api-client`, `@neondatabase/serverless`, `@dyad-sh/supabase-management-js`, `pg` (via local packages), `@vercel/sdk` | — |
| Misc | `fuse.js`, `jsonrepair`, `recast`, `@babel/parser`, `tree-kill`, `kill-port`, `fix-path`, `shell-env`, `ws`, `yaml`, `uuid`, `ignore`, `glob` | — |

---

## 4. TypeScript configuration

`tsconfig.json` is a project-references root with two projects:

| Project | Key settings |
|---------|--------------|
| `tsconfig.app.json` (src, e2e-tests, shared, packages/*/src) | `strict: true`, `target: ES2020`, `lib: [ES2022, DOM, DOM.Iterable]`, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `isolatedModules`, `noEmit`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`, **`noUnusedLocals: false`, `noUnusedParameters: false`**, `skipLibCheck: true`, path alias `@/* → src/*` |
| `tsconfig.node.json` (src, packages) | `noImplicitAny: true` only — **not `strict`**; `target: ES2022`, `allowJs`, `esModuleInterop`, `sourceMap` |

Observations for later phases: main and renderer share one `tsconfig.app.json` and one `src/` tree; there is no compile-time separation between processes. Workers have their own `tsconfig.json`.

---

## 5. Database

| Item | Value |
|------|-------|
| Engine | SQLite via `better-sqlite3` |
| ORM | Drizzle ORM; schema at `src/db/schema.ts` (847 lines) |
| Location | `<userData>/sqlite.db` (`drizzle.config.ts` → `getUserDataPath()` in `src/paths/paths.ts`) |
| Migrations | `drizzle/0000_*.sql` … `drizzle/0050_*.sql` — **51 SQL migrations** + `drizzle/meta/` journal; generated by `drizzle-kit generate`; applied at startup by `initializeDatabase()` in `src/db/index.ts` (mechanism traced in Phase 8) |
| Settings | Separate JSON settings file (`src/main/settings.ts`, `getSettingsFilePath`) — not in SQLite (UNVERIFIED split of responsibilities; traced in Phase 8) |
| Backups | `src/backup_manager.ts` (traced in Phase 8) |

---

## 6. Build system

Electron Forge `VitePlugin` builds **six bundles**:

| Target | Entry | Config | Notes |
|--------|-------|--------|-------|
| main | `src/main_bootstrap.ts` | `vite.main.config.mts` | CJS; dynamic-imports `./main` so Squirrel hooks exit fast; custom plugin asserts the deferred-import bundle shape |
| preload | `src/preload.ts` | `vite.preload.config.mts` | — |
| worker | `workers/code_explorer/code_explorer_worker.ts` | `vite.code-explorer-worker.config.mts` | `typescript` externalized |
| worker | `workers/supabase_dependency_analysis/…worker.ts` | `vite.supabase-dependency-analysis-worker.config.mts` | — |
| worker | `src/ipc/utils/sandbox/sandbox_worker.ts` | `vite.sandbox-worker.config.mts` | `mustardscript`, `pg` externalized |
| renderer | `index.html` → `src/renderer.tsx` | `vite.renderer.config.mts` | React Compiler + Tailwind |

Externals kept out of the main bundle: Node builtins, `better-sqlite3`, `dyad-keychain-reader`, `node-pty`, `ssh2`, `mustardscript`, `pg`, `ws`.

Native rebuild set: `better-sqlite3`, `node-pty`, `mustardscript`, (+ `dyad-keychain-reader` on macOS). Linux release builds force `clang-18`.

---

## 7. Packaging & distribution

| Item | Value |
|------|-------|
| Makers | Squirrel (Windows), ZIP (macOS), deb, rpm, custom AppImage (`makers/MakerAppImage.ts`) |
| Electron fuses | `RunAsNode=false`, `EnableCookieEncryption=true`, `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=<e2e builds only>`, `EnableEmbeddedAsarIntegrityValidation=true`, `OnlyLoadAppFromAsar=true` |
| asar unpack | `dyad-keychain-reader`, `node-pty`, `mustardscript`, `@mustardscript` |
| extraResource | `node_modules/dugite/git`, `node_modules/@vscode` (ripgrep) |
| Packager `ignore` | Allowlist-style filter keeping only the runtime `node_modules` actually required (pg family, ssh2 family, etc.) — see `forge.config.ts` |
| Custom protocol | `dyad://` (deep links for OAuth returns, add-prompt, add-MCP-server) |
| Code signing | Windows: Azure Trusted Signing (`windowsSign.ts`); macOS: Developer ID + notarization (`osxSign`/`osxNotarize`) |
| Publisher | `@electron-forge/publisher-github` — **draft** release, `prerelease` derived from version string |
| Auto-update | `update-electron-app` (Squirrel on Windows; GitHub releases feed) — details in Phase 2 |

---

## 8. Supported platforms

| Platform | Status | Evidence |
|----------|--------|----------|
| macOS (arm64) | Primary | release matrix `macos-latest`; self-hosted ARM64 e2e runners |
| macOS (x64) | Supported | release matrix `macos-26-intel` |
| Windows (x64) | Primary | release matrix `windows-2022`; unit + e2e in CI |
| Linux (x64) | **Experimental** | deb/rpm/AppImage built in release; CI comment: "Linux support for Dyad is experimental"; no Linux e2e |

---

## 9. Test frameworks

| Kind | Framework | Count at snapshot | Config |
|------|-----------|-------------------|--------|
| Unit | Vitest 3 (`happy-dom`), project `unit` | ~620 `*.test.ts(x)` + 48 `*.spec.ts` under `src/` | `vitest.config.ts` |
| Integration ("hybrid harness": renderer + real IPC handlers + fake services) | Vitest project `integration`, `pool: forks`, setup `src/testing/hybrid.setup.ts` | 73 `*.integration.test.ts(x)` | `vitest.config.ts`, `rules/hybrid-testing.md` |
| Evals | Vitest with `vitest.eval.config.ts` | 80 files under `src/__tests__/evals/` | `npm run eval` |
| E2E | Playwright 1.58 driving the **packaged Electron app**; textual snapshots only (no screenshots) | 132 spec files in `e2e-tests/`; 542 files incl. snapshots/fixtures | `playwright.config.ts` |
| Fake providers | `testing/fake-llm-server` (Express; OpenAI chat, Responses, Anthropic, local-agent tool fixtures, GitHub, Coolify, consent classifier), fake stdio/http/oauth MCP servers | — | `testing/` |
| Script tests | `node --test` for release/triage scripts | 6 files | `package.json#scripts.test` |
| Storybook | Storybook 8.6 | 1 story | `.storybook/` |
| Sub-packages | Vitest (+ Postgres integration for `ts-pg-schema-diff`) | 4 files | `packages/*/vitest*.config.ts` |
| Benchmarks | Node scripts for code-explorer | `benchmarks/code-explorer/` | `npm run benchmark:code-explorer*` |

---

## 10. CI configuration (`.github/workflows/`)

21 workflows. The two that matter for the engineering baseline:

**`ci.yml`** (push to `main`, PRs):
1. `check-changes` — computes changed files; skips app tests for `.claude/`/`rules/`-only changes; gates sub-package tests on path; detects a hard-coded allowlist of "privileged authors" to choose **self-hosted macOS ARM64** runners vs GitHub-hosted mac+windows.
2. `ts-pg-schema-diff-tests` (needs Postgres), `pg-schema-classifier-tests`.
3. `build-e2e-artifacts` — `npm run pre:e2e` (packaged e2e build) on mac (+ windows for non-privileged).
4. `unit-tests-macos` — `presubmit` (fmt + lint), `npm run ts`, `npm run test`; `unit-tests-windows` — tests only.
5. `safe-storage-e2e` — macOS keychain identity regression, GitHub-hosted only.
6. `e2e-tests` — 4 shards × OS; clones `dyad-sh/nextjs-template`; pre-installs scaffold deps with pnpm; runs against fake LLM servers.
7. `merge-reports`.

Other workflows: AI-driven PR review (`claude-pr-review`, `codex-pr-review`), issue triage, e2e de-flaking, stale PR management, CLA check, security-advisory alerts, unauthorized-release removal, nightly runner cleanup.

---

## 11. Release process (`release.yml`)

Manual `workflow_dispatch` only:
1. `prepare-release` creates/updates an unpublished release tag (`scripts/prepare-release-tag.js`).
2. `build` matrix (windows-2022, ubuntu-22.04, macos-26-intel, macos-latest), **no GitHub Actions cache** (supply-chain note in workflow), `npm ci`, signing tool setup, `electron-forge publish --dry-run` with 3 retries, generates + attests a **release provenance manifest** (`actions/attest`), uploads artifacts.
3. `publish` downloads all artifacts, `electron-forge publish --from-dry-run` to a **draft** GitHub release, uploads provenance, verifies tag still points at the workflow commit, verifies all assets present.
4. A separate `remove-unauthorized-release.yml` deletes releases not produced by this workflow.

Versioning: `npm run bump` (`scripts/bump-version.mjs`); prerelease detection via `scripts/release-version-utils.js`.

---

## 12. Renderer security baseline (verified in `src/main.ts`)

| Setting | Value | Line |
|---------|-------|------|
| `nodeIntegration` | `false` | `src/main.ts:896` |
| `contextIsolation` | `true` | `src/main.ts:897` |
| `preload` | `preload.js` with **static channel allowlists** (`VALID_INVOKE_CHANNELS`, `VALID_SEND_CHANNELS`, `VALID_RECEIVE_CHANNELS`) + dynamic `terminal:data:*`/`terminal:exit:*` receive channels | `src/preload.ts` |
| `sandbox` | not set explicitly — Electron default (`true` since Electron 20 when `nodeIntegration` is false) — **UNVERIFIED**; confirm in Phase 2 via `src/main/window_security.ts` | — |
| Navigation | `will-navigate` → `rejectUnexpectedNavigation`; `setWindowOpenHandler` with popup deny | `src/main.ts:998-1015` |
| Fuses | see §7 | `forge.config.ts` |

---

## 13. Known unverified items carried into later phases

- `UNVERIFIED` biome runtime usage (Phase 5).
- `UNVERIFIED` explicit `sandbox` setting and CSP (Phase 2/9).
- `UNVERIFIED` exact split between JSON settings file and SQLite (Phase 8).
- `UNVERIFIED` auto-update feed details and update-error handling (Phase 2).
- `UNVERIFIED` how `@typescript/typescript6` vs `@typescript/old` are selected at runtime (Phase 6).
