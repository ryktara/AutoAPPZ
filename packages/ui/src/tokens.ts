/**
 * Design tokens (docs/design/DESIGN-SYSTEM.md). Semantic names only; raw palette values live here
 * and nowhere else. Both themes satisfy WCAG AA for text on surfaces.
 */
export const spacing = {
  0: "0",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "24px",
  6: "32px",
  7: "48px",
} as const;

export const radius = { sm: "4px", md: "8px", lg: "12px", full: "9999px" } as const;

export const typography = {
  fontSans: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  fontMono: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  size: { xs: "12px", sm: "13px", md: "14px", lg: "16px", xl: "20px", xxl: "28px" },
  weight: { regular: 400, medium: 500, semibold: 600 },
  lineHeight: { tight: 1.25, normal: 1.5 },
} as const;

export const motion = { fast: "120ms", normal: "200ms", easing: "cubic-bezier(0.2, 0, 0, 1)" } as const;

export const lightColors = {
  bg: "#ffffff",
  bgSubtle: "#f6f7f9",
  bgElevated: "#ffffff",
  border: "#d9dde3",
  borderStrong: "#b3bac4",
  text: "#151a21",
  textMuted: "#5b6573",
  accent: "#2f6fed",
  accentText: "#ffffff",
  success: "#1f8a4c",
  warning: "#b26a00",
  danger: "#c8323a",
  info: "#2563eb",
  focus: "#2f6fed",
} as const;

export const darkColors: Record<keyof typeof lightColors, string> = {
  bg: "#0f1216",
  bgSubtle: "#161a20",
  bgElevated: "#1c2129",
  border: "#2a313b",
  borderStrong: "#3d4652",
  text: "#e8ecf1",
  textMuted: "#9aa5b3",
  accent: "#6b9cff",
  accentText: "#0b1020",
  success: "#4cc47a",
  warning: "#f0b34a",
  danger: "#ff6b70",
  info: "#7aa7ff",
  focus: "#8fb4ff",
};

export type ColorToken = keyof typeof lightColors;

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

/** Emits CSS custom properties for both themes; consumed once at app start. */
export function tokensToCss(): string {
  const vars = (colors: Record<string, string>) =>
    Object.entries(colors)
      .map(([k, v]) => "  --color-" + kebab(k) + ": " + v + ";")
      .join("\n");
  const spacingVars = Object.entries(spacing)
    .map(([k, v]) => "  --space-" + k + ": " + v + ";")
    .join("\n");
  const radiusVars = Object.entries(radius)
    .map(([k, v]) => "  --radius-" + k + ": " + v + ";")
    .join("\n");
  return [
    ":root {",
    vars(lightColors),
    spacingVars,
    radiusVars,
    "  --font-sans: " + typography.fontSans + ";",
    "  --font-mono: " + typography.fontMono + ";",
    "  --motion-fast: " + motion.fast + ";",
    "  --motion-normal: " + motion.normal + ";",
    "}",
    '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {',
    vars(darkColors),
    "} }",
    ':root[data-theme="dark"] {',
    vars(darkColors),
    "}",
    "@media (prefers-reduced-motion: reduce) { :root { --motion-fast: 0ms; --motion-normal: 0ms; } }",
    ':root[data-reduced-motion="true"] { --motion-fast: 0ms; --motion-normal: 0ms; }',
  ].join("\n");
}
