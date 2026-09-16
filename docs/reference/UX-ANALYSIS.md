# UX / Product Analysis — `dyad-sh/dyad` @ `39064d24`

Analysis of the product model as evidenced by routes, components, settings, e2e specs and the maintainers' `PRODUCT.md`. Judgements are marked as such.

---

## 1. Product model

- **Primary object: the App** (folder + git repo + chats). Secondary objects: Chat (per app, mode/model latched), Version (git commit), Plan (`.dyad/plans`), Blueprint (transient), Collection (folder of apps), Library items (prompts, media, themes), Plugins (MCP servers), Templates.
- **Primary loop: prompt → streamed transcript with cards → live preview → fix**. The chat transcript is the system of record for what the AI did; "Modified files", "Version pane", "Problems", "Console" are secondary views.
- **Audience** (per `PRODUCT.md`): non-technical builders first, tinkerers second; principles "never a dead end", "protect the moment of intent", "translate, don't expose", "calm confidence", "motion explains".

## 2. Information architecture (observed)

```
Home (/)               prompt box · inspiration prompts · import · featured showcase · setup banner
Apps (/apps)           list/grid · favorites · collections · search · thumbnails
Chat (/chat?id)        left: chat tabs + transcript + input; right: preview panel
                       preview modes: Preview · Code · Problems · Console · Terminal · Tests · Plan · Security · Publish · Configure · Database
App details (/app-details) rename · location · commands · integrations (GitHub/Supabase/Neon/Vercel/Coolify) · upgrades · Capacitor · delete
Library (/library)     prompts · media · themes
Templates (/templates) official + community
Plugins (/plugins)     MCP catalog + servers + tool consents
Settings (/settings)   searchable sections · providers/$provider pages
```

Judgement: IA is app-centric and reasonably flat, but the **preview panel hosts ten modes** (a mode switcher, not a workspace), and integrations are split between app details and preview-panel "Configure/Publish/Database" tabs — the same concept (e.g., Neon) appears in three places.

## 3. Onboarding and first success

| Aspect | Observation | Judgement |
|---|---|---|
| First screen | Prompt-first; provider setup deferred until the first send; the prompt is parked and auto-resumed | Strong pattern (protects intent) — keep |
| Provider choices | Vendor trial first, subscription second, OpenRouter, "other providers" → settings | Commercial funnel dominates the first decision; BYOK is one click deeper — redesign |
| Node.js dependency | Detected; managed Node install offered; PATH refresh logic | Good; keep, but make it a background prerequisite with progress, not a dialog chain |
| Blueprint questionnaire | 1–5 product questions then an editable blueprint card (name, template, theme, color, visuals) | Good concept; too shallow for "complete product" (no pages/entities/roles) — extend |
| Time to first preview | create app → template copy → first turn → install+dev server (cold pnpm install) | Install dominates; nothing runs while the model streams — parallelize |

## 4. Chat / AI usability

- Rich card vocabulary (write/edit/read/grep/search/sql/todos/subagent team/questionnaire/blueprint/plan/test assertions…) — transparent, but the transcript becomes long; there is no separate "plan/execution/changes/validation" structure — everything is a linear transcript.
- Consent banners (agent tool / MCP / SQL) interrupt the flow; "always allow" is per tool name (coarse).
- Queued messages, cancellation banner, step-limit card, context-limit banner, token bar: good operational transparency.
- Modes (Agent/Build/Ask/Plan) + model picker + effort + mode/model compatibility rules exposed to beginners: **high cognitive load**; the product's own rules say Build exists for "legacy-only constraints".
- Errors: `ChatErrorBox` with request IDs; quota errors with upgrade CTA; provider errors verbatim (technical).

## 5. Preview experience

- Iframe with address bar, device sizes, refresh/restart/rebuild, component selector (select-to-edit), screenshot, annotator (Pro), visual editing (Pro), console filters, terminal, tests, "Clear cache".
- Loading state: "Waiting for server logs…" (documented as a support hotspot); error banner with Fix with AI.
- Judgement: the preview is strong; the missing piece is **structured runtime intelligence feeding the agent automatically** (currently user-triggered).

## 6. Errors, loading, empty states, settings

- Empty states exist for apps list, chats, tests, plans; e2e snapshots cover many.
- Toasts (`sonner`) for operation results; persistent error toasts for settings recovery.
- Settings: searchable, many toggles (≈60), experiments, per-tool permissions table, sub-agent toggles — power-user friendly, overwhelming for the target persona.
- Localization in 9 languages; WCAG AA targeted per `PRODUCT.md` (not audited here).

## 7. Project organization, Git, database, deployment concepts

- Apps live in `~/dyad-apps` (or custom folder); import copies by default (in-place optional) — surprising for developers.
- Git is mostly hidden ("versions", "undo", "restore to message") with an escape hatch (branches, commit dialog, uncommitted-files banner). Judgement: good translation layer; keep the vocabulary, expose branches only in advanced views.
- Database: "Add integration" via chat → OAuth → project pick → branch semantics (Neon dev/preview/prod) surface quickly; the "Database" tab shows env vars and branch pickers. Judgement: branch/time-travel semantics are powerful but leak provider concepts.
- Deployment: Publish tab (Vercel; Coolify experimental) with env sync; no preview-of-changes before deploy; no deployment readiness checklist.

## 8. What to retain conceptually

1. Prompt-first home with parked intent and auto-resume.
2. Every AI turn is a git version; undo/restore-to-message as first-class actions.
3. Live preview with runtime error → "fix" affordance; component selection to scope edits.
4. Transparent tool cards, todo list, questionnaires, blueprint card, plan annotations.
5. Per-tool consent with once/always; SQL and MCP safety classification.
6. Problems panel driven by the project's own type checker; tests panel with recorder.
7. Managed Node runtime and package-manager safety nudges translated into user language.
8. Searchable settings; provider pages with validation.

## 9. What to redesign

1. **Workspace instead of chat-with-modes**: separate Request / Plan / Execution / Changes / Validation surfaces with a problems/terminal/logs dock (Phase 42), while keeping the transcript for narrative.
2. **Collapse modes**: one agent with capability levels (read-only "Ask" and "Plan" as views/phases, not modes); remove the legacy Build mode.
3. **Blueprint → product spec**: pages, entities, roles, flows, acceptance criteria; persisted and evolvable.
4. **Automatic validation and repair** after each execution with structured diagnostics; user sees results, not raw logs.
5. **Permission scopes**, not tool names; risk-tiered consent UI with "what will happen".
6. **Integrations as a single surface** per project with readiness status (DB, auth, deploy, git), not scattered tabs.
7. **BYOK/local-first onboarding** without a commercial funnel; providers as equal cards; local models discoverable.
8. **Cost/usage visibility** per task (tokens, requests, estimated cost) — currently only a token bar and vendor budget.
9. **Fewer, clearer settings**; experiments hidden behind a developer section.
10. **Cross-platform parity**: Windows/Linux users hit skipped-test areas.
