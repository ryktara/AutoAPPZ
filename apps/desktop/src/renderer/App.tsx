import { useCallback, useEffect, useMemo, useState } from "react";
import { settings } from "@autoappz/contracts";
import { AppShell } from "@autoappz/ui";
import { RuntimeContext, useQuery } from "./state/hooks.ts";
import { RouterContext, useRouter, type Route } from "./state/router.ts";
import type { RendererRuntime } from "./state/runtime.ts";
import { HomeScreen } from "./screens/HomeScreen.tsx";
import { ProjectScreen } from "./screens/ProjectScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";

const NAV = [
  { id: "home", label: "Projects" },
  { id: "settings", label: "Settings" },
] as const;

export function App({ runtime }: { readonly runtime: RendererRuntime }) {
  const [route, setRoute] = useState<Route>({ name: "home" });
  const navigate = useCallback((next: Route) => {
    setRoute(next);
  }, []);
  const router = useMemo(() => ({ route, navigate }), [route, navigate]);
  return (
    <RuntimeContext.Provider value={runtime}>
      <RouterContext.Provider value={router}>
        <Shell />
      </RouterContext.Provider>
    </RuntimeContext.Provider>
  );
}

function Shell() {
  const { route, navigate } = useRouter();
  useThemeSync();
  const activeId = route.name === "settings" ? "settings" : "home";
  return (
    <AppShell
      brand="AutoAPPZ"
      nav={NAV}
      activeId={activeId}
      onNavigate={(id) => {
        navigate(id === "settings" ? { name: "settings" } : { name: "home" });
      }}
      footer={<span>Local-first · no account required</span>}
    >
      {route.name === "home" ? (
        <HomeScreen />
      ) : route.name === "settings" ? (
        <SettingsScreen />
      ) : (
        <ProjectScreen key={route.id} id={route.id} />
      )}
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
