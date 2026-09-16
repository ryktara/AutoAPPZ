import { workspace } from "@autoappz/contracts";
import { Banner, Card, Page } from "@autoappz/ui";
import { useQuery } from "../state/hooks.ts";

export function HomeScreen() {
  const info = useQuery(workspace.workspaceInfo, undefined);
  return (
    <Page title="Home" subtitle="Local-first, agentic software engineering.">
      <Card title="Workspace">
        {info.status === "error" ? (
          <Banner tone="danger">{info.error?.message ?? "Could not reach the host."}</Banner>
        ) : (
          <p data-testid="status" className="az-muted">
            {info.data
              ? `Workspace ready. Session ${info.data.sessionId.slice(0, 8)} · v${info.data.appVersion} · ${info.data.platform}`
              : "Connecting to host…"}
          </p>
        )}
        {info.data ? (
          <p className="az-muted">
            Data directory: <code>{info.data.dataDirectory}</code>
          </p>
        ) : null}
      </Card>
      <Card title="Projects" description="Project creation arrives in the next milestone.">
        <p className="az-muted">Nothing here yet.</p>
      </Card>
    </Page>
  );
}
