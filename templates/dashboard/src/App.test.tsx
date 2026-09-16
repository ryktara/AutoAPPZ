import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./App.tsx";
import { linePath } from "./components/LineChart.tsx";

describe("dashboard", () => {
  it("renders the overview with KPIs and a chart", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("Revenue");
    expect(html).toContain("Revenue by day");
    expect(html).toContain('<path d="M');
  });

  it("computes a chart path that starts with a move and scales to the height", () => {
    const d = linePath([0, 10, 5], 100, 50, 0);
    expect(d).toBe("M0.0,50.0 L50.0,0.0 L100.0,25.0");
    expect(linePath([], 100, 50)).toBe("");
  });
});
