import { useEffect, useState } from "react";
import { workspace } from "@autoappz/contracts";

type WorkspaceInfo = workspace.WorkspaceInfo;
import type { CommandBusClient } from "@autoappz/command-bus";
import { AppShell } from "@autoappz/ui";

export function App({ client }: { readonly client: CommandBusClient }) {
  const [info, setInfo] = useState<WorkspaceInfo | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    client
      .dispatch(workspace.workspaceInfo, undefined)
      .then((i) => {
        if (!cancelled) setInfo(i);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return (
    <AppShell
      title="AutoAPPZ"
      status={info ? "v" + info.appVersion + " · " + info.platform : (error ?? "connecting…")}
    >
      <p data-testid="status" style={{ color: "var(--color-text-muted)" }}>
        {info
          ? "Workspace ready. Session " + info.sessionId.slice(0, 8) + "."
          : error
            ? "Error: " + error
            : "Connecting to host…"}
      </p>
    </AppShell>
  );
}
