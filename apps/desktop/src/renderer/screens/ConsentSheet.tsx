import { useEffect, useMemo, useState } from "react";
import { permissions } from "@autoappz/contracts";
import { Banner, Button, Tag } from "@autoappz/ui";
import { useCommand, useQuery, useRuntime } from "../state/hooks.ts";

const RISK_COPY: Record<permissions.RiskTier, string> = {
  low: "Low risk",
  medium: "Changes files in this project",
  high: "High impact",
  destructive: "Destructive — cannot be undone by AutoAPPZ",
};

/**
 * Consent sheet for parked tool calls (docs/security/PERMISSIONS.md). Shows what will happen, where,
 * why, and the four choices. Rendered once at the app root; listens to consent events.
 */
export function ConsentSheet() {
  const { client, cache } = useRuntime();
  const pending = useQuery(
    permissions.permissionsPending,
    useMemo(() => ({}), []),
  );
  const respond = useCommand(permissions.permissionsRespond);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const off = client.on(permissions.consentRequested, () => {
      cache.invalidate(["consent"]);
    });
    const off2 = client.on(permissions.consentResolved, () => {
      cache.invalidate(["consent", "permissions", "audit"]);
    });
    const t = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      off();
      off2();
      clearInterval(t);
    };
  }, [client, cache]);

  const request = pending.data?.[0];
  if (!request) return null;
  const secondsLeft = Math.max(0, Math.round((request.deadlineAt - now) / 1000));
  const choose = (choice: permissions.ConsentChoice) => void respond.run({ requestId: request.id, choice });

  return (
    <div className="az-sheet-backdrop" role="presentation">
      <section
        className="az-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        data-testid="consent-sheet"
      >
        <h2 id="consent-title" className="az-card-title">
          Allow this action?
        </h2>
        <p className="az-consent-desc">{request.description}</p>
        <dl className="az-dl">
          <dt>Tool</dt>
          <dd>
            <code>{request.toolId}</code>
          </dd>
          <dt>Where</dt>
          <dd>
            <code>{request.scope}</code>
          </dd>
          <dt>Risk</dt>
          <dd>
            <Tag>{request.risk}</Tag> {RISK_COPY[request.risk]}
          </dd>
          <dt>Task</dt>
          <dd>
            <code>{request.taskId.slice(0, 12)}</code>
          </dd>
        </dl>
        {request.preview ? <pre className="az-preview">{request.preview}</pre> : null}
        {respond.error ? <Banner tone="danger">{respond.error.message}</Banner> : null}
        <div className="az-row">
          <Button variant="primary" disabled={respond.pending} onClick={() => choose("allow_once")}>
            Allow once
          </Button>
          <Button disabled={respond.pending} onClick={() => choose("allow_session")}>
            Allow this session
          </Button>
          {request.risk !== "destructive" ? (
            <Button disabled={respond.pending} onClick={() => choose("allow_project")}>
              Always for this project
            </Button>
          ) : null}
          <Button variant="danger" disabled={respond.pending} onClick={() => choose("deny")}>
            Deny
          </Button>
          <span className="az-muted" data-testid="consent-deadline">
            {secondsLeft}s left
            {(pending.data?.length ?? 0) > 1
              ? ` · ${String((pending.data?.length ?? 1) - 1)} more waiting`
              : ""}
          </span>
        </div>
      </section>
    </div>
  );
}
