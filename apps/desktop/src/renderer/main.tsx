import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { tokensToCss } from "@autoappz/ui";
import "@autoappz/ui/ui.css";
import { App } from "./App.tsx";
import { connectRuntime } from "./state/runtime.ts";

const style = document.createElement("style");
style.textContent = tokensToCss();
document.head.appendChild(style);

const container = document.getElementById("root");
if (!container) throw new Error("missing #root");
const root = createRoot(container);

if (!window.autoappz) {
  root.render(<p>Bridge unavailable.</p>);
} else {
  void connectRuntime(window.autoappz).then((runtime) => {
    root.render(
      <StrictMode>
        <App runtime={runtime} />
      </StrictMode>,
    );
  });
}
