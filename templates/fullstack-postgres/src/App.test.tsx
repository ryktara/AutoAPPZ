import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./App.tsx";

describe("App", () => {
  it("renders the loading state on the server", () => {
    expect(renderToStaticMarkup(<App />)).toContain("Loading");
  });
});
