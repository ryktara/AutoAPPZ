import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { tokensToCss } from "@autoappz/ui";
import { App } from "./App.tsx";
import { connectBus } from "./bus.ts";

const style = document.createElement("style");
style.textContent = tokensToCss();
document.head.appendChild(style);

const container = document.getElementById("root");
if (!container) throw new Error("missing #root");
const root = createRoot(container);

if (!window.autoappz) {
  root.render(<p>Bridge unavailable.</p>);
} else {
  void connectBus(window.autoappz).then((client) => {
    root.render(
      <StrictMode>
        <App client={client} />
      </StrictMode>,
    );
  });
}
