import { createContext, useContext } from "react";

export type Route = { name: "home" } | { name: "settings" } | { name: "project"; id: string };

export const RouterContext = createContext<{ route: Route; navigate: (route: Route) => void } | undefined>(
  undefined,
);

export function useRouter(): { route: Route; navigate: (route: Route) => void } {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("RouterContext missing");
  return ctx;
}
