import { useEffect, useState } from "react";
import { settings } from "@autoappz/contracts";
import { AppShell } from "@autoappz/ui";
import { RuntimeContext, useQuery } from "./state/hooks.ts";
import type { RendererRuntime } from "./state/runtime.ts";
import { HomeScreen } from "./screens/HomeScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";

const NAV = [
  { id: "home", label: "Home" },
  { id: "settings", label: "Settings" },
] as const;
type ScreenId = (typeof NAV)[number]["id"];

export function App({ runtime }: { readonly runtime: RendererRuntime }) {
  return (
    <RuntimeContext.Provider value={runtime}>
      <Shell />
    </RuntimeContext.Provider>
  );
}

function Shell() {
  const [screen, setScreen] = useState<ScreenId>("home");
  useThemeSync();
  return (
    <AppShell
      brand="AutoAPPZ"
      nav={NAV}
      activeId={screen}
      onNavigate={(id) => {
        setScreen(id as ScreenId);
      }}
      footer={<span>Local-first · no account required</span>}
    >
      {screen === "home" ? <HomeScreen /> : <SettingsScreen />}
    </AppShell>
  );
}

/** Applies theme and motion preferences to <html> so tokens can switch without a re-render of the tree. */
function useThemeSync() {
  const s = useQuery(settings.settingsGet, undefined);
  useEffect(() => {
    const root = document.documentElement;
    const theme = s.data?.theme ?? "system";
    if (theme === "system") delete root.dataset["theme"];
    else root.dataset["theme"] = theme;
    if (s.data?.reducedMotion) root.dataset["reducedMotion"] = "true";
    else delete root.dataset["reducedMotion"];
  }, [s.data?.theme, s.data?.reducedMotion]);
}
