import { describe, expect, it } from "vitest";
import { darkColors, lightColors, tokensToCss } from "../src/tokens.ts";

function luminance(hex: string): number {
  const c = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((h) => parseInt(h, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const contrast = (a: string, b: string) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
};

describe("design tokens", () => {
  it.each([
    ["light", lightColors],
    ["dark", darkColors],
  ])("%s theme meets WCAG AA for body and muted text", (_name, c) => {
    expect(contrast(c.text, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.textMuted, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.accentText, c.accent)).toBeGreaterThanOrEqual(4.5);
  });
  it("emits css variables for both themes", () => {
    const css = tokensToCss();
    expect(css).toContain("--color-bg: #ffffff");
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain("--color-text-muted");
  });
});
