import { useMemo } from "react";
import { permissions } from "@autoappz/contracts";
import { EmptyState, Tag } from "@autoappz/ui";
import { useQuery } from "../../state/hooks.ts";
import type { TaskStreamView } from "../../state/use-task-stream.ts";

/** Tool activity for the active task: live stream while running, audit rows afterwards. */
export function ExecutionPanel({
  taskId,
  live,
}: {
  readonly taskId: string | undefined;
  readonly live: TaskStreamView;
}) {
  const audit = useQuery(
    permissions.toolAudit,
    useMemo(() => ({ taskId: taskId ?? "-" }), [taskId]),
  );
  if (!taskId) return <EmptyState>Tool activity streams here while the agent works.</EmptyState>;
  const rows =
    live.tools.length > 0
      ? live.tools
      : (audit.data ?? []).map((a) => ({
          callId: a.id,
          toolId: a.toolId,
          description: `${a.toolId} ${a.scope}`,
          status: a.decision === "deny" ? ("error" as const) : a.ok ? ("ok" as const) : ("error" as const),
          summary: a.decision === "deny" ? `not allowed (${a.decisionSource})` : a.resultSummary,
        }));
  return (
    <div className="az-stack" data-testid="execution">
      {live.notes.map((n, i) => (
        <p key={`n${String(i)}`} className="az-muted">
          {n}
        </p>
      ))}
      {rows.length === 0 ? (
        <EmptyState>{live.done ? "No tools were used." : "Waiting for tool activity…"}</EmptyState>
      ) : (
        <ul className="az-list" aria-label="Tool activity">
          {rows.map((t) => (
            <li key={t.callId} className="az-list-row">
              <Tag>{t.status === "running" ? "running" : t.status}</Tag>
              <code>{t.toolId}</code>
              <span className="az-list-grow">
                <div>{t.description}</div>
                {t.summary ? <div className="az-list-secondary az-clamp">{t.summary}</div> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {live.text && live.done ? (
        <div className="az-msg az-msg-assistant" style={{ maxWidth: "none" }}>
          <div className="az-msg-role">Summary</div>
          <div className="az-msg-body">{live.text}</div>
        </div>
      ) : null}
    </div>
  );
}
