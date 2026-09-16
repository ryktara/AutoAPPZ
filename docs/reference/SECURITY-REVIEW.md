# Security Review — `dyad-sh/dyad` @ `39064d24`

Descriptive review of the reference's security boundaries. Findings inform `docs/design/THREAT-MODEL.md`.

---

## 1. Electron shell

| Control | State | Evidence |
|---|---|---|
| `contextIsolation` | on | `main.ts:897` |
| `nodeIntegration` | off | `main.ts:896` |
| Renderer sandbox | **default-on** (Electron ≥20 sandboxes renderers with `nodeIntegration:false` unless `sandbox:false`); not set explicitly; preload uses only `contextBridge`/`ipcRenderer`/`webFrame`, consistent with a sandboxed preload | `main.ts`, `preload.ts` |
| Preload surface | `window.electron.ipcRenderer.{invoke, invokeEnvelope, send, on, removeListener, removeAllListeners}` gated by static channel allowlists; `webFrame.setZoomFactor/getZoomFactor` | `preload.ts` |
| Navigation | `will-navigate`/`will-redirect` blocked unless same origin as dev server or exact packaged `index.html`; TanStack history makes `file:///chat` etc. legitimate — trust check allowlists route paths | `window_security.ts`, `renderer_security.ts` |
| Child windows | `setWindowOpenHandler`: deny unless HTTP(S) target with a non-app HTTP referrer (preview popups), no privileged features; popup created manually with preload stripped and `sandbox:true, contextIsolation:true, nodeIntegration:false, webSecurity:true, webviewTag:false`; popups cannot open further windows | `window_security.ts`, `main.ts:1001-1017` |
| IPC trust | every `ipcMain.handle` goes through `registerTrustedIpcHandler` → `assertTrustedRenderer` (sender frame is main frame by identity, URL is dev origin or packaged file route) | `trusted_handle.ts`, `renderer_security.ts` |
| Fuses | RunAsNode off, NODE_OPTIONS off, CLI inspect off (except e2e), asar integrity on, only-load-from-asar | `forge.config.ts` |
| CSP | **none found** for the renderer (`UNVERIFIED`: no `Content-Security-Policy` meta in `index.html` or session headers) | grep |
| Remote content in privileged windows | none; previews are separate origins (iframe or `WebContentsView`) | — |
| Custom protocols | `dyad-media://` (bounded media/thumbnail serving with app-id resolution); `dyad://` deep links | `main/dyad_media_protocol.ts`, `main.ts` |
| Preview CDP | Playwright-in-preview uses an ephemeral loopback CDP broker with random bearer token, scoped to one target; deliberately incomplete command set | `docs/security.md`, `preview_cdp_broker.ts` |

Assessment: the shell boundary is above average for Electron apps. Missing: explicit CSP; explicit `sandbox: true`; per-window/per-app capability scoping.

## 2. IPC

- Validation: ~90% typed (Zod), ~20 legacy handlers unvalidated (see `IPC-CATALOG.md §2.1`).
- Secrets to renderer: `get-user-settings` and `get-env-vars` return decrypted API keys/tokens; the renderer shows them in provider settings. Threat: any renderer code execution → credential theft. Renderer attack surface includes markdown rendering of model output (`react-markdown` — sanitized by default), Monaco, Lexical, and the `DyadMarkdownParser` custom XML → React mapping (`UNVERIFIED` for injection; it maps tags to components rather than dangerouslySetInnerHTML).
- Debug logging: legacy handlers log arguments at debug level (potential secret leakage into `main.log` and debug bundles). Session debug bundles include filtered logs; `git_remote_token_scrub` exists because tokens previously leaked into git remotes.
- Error projection: `safeGithubOpsErrorMessage` denylist redaction for paths/tokens before renderer; rules acknowledge denylists cannot guarantee removal.

## 3. Shell execution and process spawning

| Surface | Mechanism | Risk |
|---|---|---|
| Dev server / install | `spawn(cmdString, [], {shell:true})` with user-configurable `installCommand && startCommand` | arbitrary command execution by design (user-configured); model cannot set these (only user via `update-app-commands`) — but the model can edit `package.json` scripts which run on next start; postinstall scripts of dependencies run with user privileges (mitigations: pnpm allow-builds policy, Socket firewall, minimum release age) |
| Package install | `pnpm add`/`npm install` via PTY runner, args arrays, spec grammar validation | supply chain (mitigated as above), `npx sfw` downloads a package at runtime |
| Git | `dugite` exec with args arrays; sanitized env; per-invocation auth env; `core.fsmonitor=false` and no smudge filters for agent inspection (rules) | repo-local config could still launch hooks on user commits (pre-commit intentionally runs hooks) |
| tsc / Playwright / build | app-local binaries executed from `node_modules` (`resolveTypeScriptCli`, Playwright bootstrap) | a malicious repo can replace `node_modules/typescript/lib/tsc.js` (the e2e test even does this) → code execution when the user runs Problems; build snapshot isolation is explicitly "not a security sandbox" |
| MCP stdio servers | user-configured `command`/`args`/env spawned | arbitrary by design; deep link `dyad://add-mcp-server?config=` can pre-fill a server config (user must still confirm? `UNVERIFIED` — payload is parsed and delivered to renderer as a deep-link event) |
| Terminal | node-pty login shell in app dir | user-driven |
| Docker | `docker build/run` with generated Dockerfile | volume-mounts the app dir |
| Sandbox scripts | mustardscript in-process; host functions read-only + gated write; strict path policy; "not treated as a hard security boundary" | model-written scripts execute with limited capabilities |
| Model-generated code execution | rules: model-generated code is untrusted; show or AST-allowlist before running | — |

## 4. Filesystem

- App-root scoping via `safeJoin` (rejects absolute, `~/`, drive, UNC, traversal) + realpath containment (`assertMutationPathAllowed`) + project-root refusal + symlink rules for delete/rename; sandbox denies `.git`, `node_modules`, `.ssh`, `.aws`, `.config`, `.npmrc`, history files, keys, `.env*` (with redaction on allowed dotenv reads).
- Legacy XML processor validates delete paths as a batch before any I/O.
- `show-item-in-folder` accepts any path (renderer-controlled), `open-file-path` restricted to `.dyad/media` + media extensions.
- In-place imports make arbitrary directories "apps"; all tools then operate there.
- Media protocol resolves by app id → path; thumbnails cached.

## 5. Credentials and secrets

| Secret | Storage | Encryption | Exposure |
|---|---|---|---|
| Provider API keys, GitHub/Vercel/Supabase/Neon/Coolify tokens, Coolify admin password, Vertex service account JSON | `user-settings.json` | `safeStorage` (OS keychain-backed) base64; `plaintext` when unavailable (Linux w/o libsecret) or test builds | decrypted on every read; returned to renderer; re-encrypted on every write; undecryptable ciphertext preserved for later recovery; legacy macOS keychain identity recovery via native addon and `security` CLI |
| MCP env/headers, OAuth state/client secret | SQLite encrypted columns (`safeStorage` or `plain:` prefix fallback) | same | env passed to spawned servers; headers to HTTP servers |
| App env (`.env`, `.env.local`) | in app folder | none | excluded from model context and redacted in reads/diffs; Neon rewrites `.env.local` (temporary test-branch swaps with crash recovery markers) |
| Git auth | never in remote URLs; injected via `GIT_CONFIG_COUNT/KEY/VALUE` env per call | — | startup scrub of legacy token URLs |
| Deploy keys (Coolify) | private halves under userData | — | deleted on reset |
| Vendor "Pro" key | `providerSettings.auto.apiKey` | as above | gates features; deep link `dyad://dyad-pro-return?key=` injects it |
| Telemetry | PostHog; exception messages filtered by kind; self-hosted channels send frames only | — | — |

Logging: settings handlers deliberately skip logging; legacy handlers log args. Redaction utilities exist for dotenv and GitHub error projection.

## 6. OAuth and deep links

- Flows: GitHub device flow (polling), Supabase/Neon/vendor via browser → `dyad://…-oauth-return?token=…&refreshToken=…`, ChatGPT subscription, MCP OAuth PKCE with local callback port (default or per-server), Coolify token minted via workaround.
- Deep-link handling: protocol check, hostname switch, param validation, `runOAuthReturnExchange` claims a pending connection flow (unsolicited returns produce dialogs); `add-mcp-server`/`add-prompt` payloads schema-parsed (`AddMcpServerConfigSchema`, `AddPromptDataSchema`) then forwarded to renderer; queued until a window is ready; ignored during shutdown.
- Risk: **tokens travel in URLs** to the OS protocol handler (visible in logs/URL history); on Linux "last registration wins" can route callbacks to another build.

## 7. Browser previews and generated applications

- Preview origin `http://localhost:<proxy port>`; injected scripts run inside the previewed app's origin and communicate via `postMessage` with `PARENT_TARGET_ORIGIN = "*"` (`dyad-shim.js`) — the renderer must validate message origin (`UNVERIFIED` in `PreviewIframe.tsx`).
- Auth bootstrap: credentials injected only when the parent echoes `authBootstrapToken` (protects against framing attacks).
- Clearing cache clears cookies for all `localhost` previews (documented limitation).
- Generated code is untrusted; it runs in the user's Node with full privileges (dev server, scripts, tests). Playwright tests run app code; isolated workspace ≠ sandbox.
- Cloud sandbox mode moves execution to the vendor.

## 8. Third-party MCP servers and prompt injection

- MCP results sanitized for size (`sanitizeMcpToolResult`), per-tool consent, catalog provenance, OAuth encryption; results are still model-visible text (prompt injection surface).
- Sub-agent reports are wrapped in data delimiters with instructions not to follow embedded instructions (rules).
- Web fetch/search/crawl (Pro) bring external content into context.
- `AI_RULES.md` (model-editable) is injected into the system prompt with `$`-safe replacement — a malicious repository can steer the model via its rules file (imported repos).
- Malicious repositories: hooks (pre-commit), `node_modules` binaries, `package.json` scripts, `.npmrc`/`pnpm-workspace.yaml` (allow-builds) can all execute code during ordinary operations; the codebase mitigates specific vectors (fsmonitor, smudge, sfw) but not the class.

## 9. Dependency installation

- Socket firewall (`sfw@2.0.4` via npx) when `blockUnsafeNpmPackages` (default on via remote config); pnpm `minimumReleaseAge=1 day`; build scripts denied unless allowlisted (remote list from vendor API, 1 h cache, 256 KB cap) with "self-heal" recording; `npm install --legacy-peer-deps` fallback has none of these protections beyond sfw (`UNVERIFIED`).
- Managed Node/pnpm downloads from the network into userData (checksum verification `UNVERIFIED`).

## 10. Deployment tokens and databases

- Vercel token and Neon/Supabase tokens stored as above; Coolify deploy keys generated locally; SQL executed via provider APIs with consent classification; destructive statements gated; Neon branch swaps write connection strings into `.env.local`.
- `reset-all` wipes DB, settings, app folders (irreversible, user-initiated).

## 11. Summary of notable findings

| # | Finding | Severity (for a local desktop app) |
|---|---|---|
| S1 | All secrets decrypted and delivered to the renderer on every settings read | High (renderer compromise = full credential theft) |
| S2 | No CSP; large third-party renderer surface (Monaco, Lexical, markdown, Konva) | Medium |
| S3 | ~20 unvalidated legacy IPC handlers; `show-item-in-folder` arbitrary path; args logged | Medium |
| S4 | Repository-provided executables (tsc, playwright, hooks, scripts) run with user privileges on routine actions; imported repos + `AI_RULES.md` steer the model | Medium/High (inherent to category; partially mitigated) |
| S5 | `kill-port` kills unrelated processes on the deterministic app port | Low/Medium (availability) |
| S6 | OAuth tokens in deep-link URLs | Medium |
| S7 | `postMessage` to `*` from preview shim; origin validation in renderer unverified | Medium |
| S8 | Plaintext secret fallback on Linux without keyring; test builds store plaintext | Medium |
| S9 | Consent model is per tool, not per scope (e.g. `write_file` "always" = unrestricted writes within app root) | Medium |
| S10 | No audit log of privileged tool executions beyond chat transcript/`agent_activities` | Low |
