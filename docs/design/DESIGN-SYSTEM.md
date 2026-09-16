# Design System

Source of truth: `packages/ui/src/tokens.ts`. This document explains the intent; the code holds the values and
`tokensToCss()` emits them as CSS custom properties at app start. Contrast requirements are enforced by
`packages/ui/test/tokens.test.ts` (WCAG AA ≥ 4.5:1 for body text, muted text and accent-on-accent text in both
themes).

## Principles

1. **Semantic tokens only.** Components reference `--color-text-muted`, never a hex value. Raw palette values live
   in `tokens.ts` and nowhere else.
2. **Two themes, one contract.** Light and dark define the same token set; a component that works in one works in
   the other. Theme selection: `data-theme="light|dark"` on `<html>` overrides `prefers-color-scheme`.
3. **Dense but breathable.** A developer tool: 13–14px body text, 4px spacing scale, 8px default radius.
4. **Motion is optional.** Durations collapse to `0ms` under `prefers-reduced-motion`; nothing depends on an
   animation completing.
5. **Keyboard first.** Every interactive element has a visible focus ring using `--color-focus`; no
   `outline: none` without a replacement.

## Tokens

| Group | Tokens |
| --- | --- |
| Color | `bg`, `bgSubtle`, `bgElevated`, `border`, `borderStrong`, `text`, `textMuted`, `accent`, `accentText`, `success`, `warning`, `danger`, `info`, `focus` |
| Spacing | `0, 4, 8, 12, 16, 24, 32, 48` px as `--space-0…7` |
| Radius | `sm 4px`, `md 8px`, `lg 12px`, `full` |
| Typography | `--font-sans` (Inter / system), `--font-mono` (JetBrains Mono / system); sizes xs 12 → xxl 28; weights 400/500/600 |
| Motion | `--motion-fast 120ms`, `--motion-normal 200ms`, easing `cubic-bezier(0.2, 0, 0, 1)` |

## Component rules (packages/ui)

- Presentational only: props in, callbacks out. No command-bus calls, no fetches, no timers that encode business
  rules. State that is not purely visual lives in renderer state modules.
- Every component ships with: keyboard behaviour, `aria-*` where the native element does not provide semantics,
  a loading and an error variant where applicable, and a test that renders it in both themes.
- Status colour is never the only signal: pair with icon or text (colour-blind safe).
- Streaming surfaces (agent output, logs) must be virtualised above ~500 rows and never block input.

## Surfaces defined in later milestones

Task timeline, plan/approval view, diff viewer, preview pane, runtime logs, context inspector, cost meter,
permission prompt, settings, first-run. Each gets a spec under `docs/design/surfaces/` when its milestone starts
(M1: shell + settings + first-run).

## Non-goals

No visual asset, colour palette, icon set, typography choice or layout is taken from any reference product. The
palette above was chosen from scratch to satisfy the contrast tests.
