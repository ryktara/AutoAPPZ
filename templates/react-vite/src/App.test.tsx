import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./App.tsx";

describe("App", () => {
  it("renders the heading", () => {
    expect(renderToStaticMarkup(<App />)).toContain("Your app is running");
  });
});
