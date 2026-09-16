import { useMemo } from "react";
import { permissions } from "@autoappz/contracts";
import { Banner, Button, Card, EmptyState, Tag } from "@autoappz/ui";
import { useCommand, useQuery } from "../../state/hooks.ts";

/** Standing permission rules for a project with revoke; audit arrives per task in the Execution pane. */
export function PermissionsPanel({ projectId }: { readonly projectId: string }) {
  const policies = useQuery(
    permissions.permissionsPolicies,
    useMemo(() => ({ projectId }), [projectId]),
  );
  const revoke = useCommand(permissions.permissionsRevoke);
  return (
    <Card
      title="Permissions"
      description="Rules created from your consent choices. Denials always win over allows; destructive actions always ask."
    >
      {revoke.error ? <Banner tone="danger">{revoke.error.message}</Banner> : null}
      {policies.data && policies.data.length > 0 ? (
        <ul className="az-list" aria-label="Permission rules">
          {policies.data.map((p) => (
            <li key={p.id} className="az-list-row">
              <Tag>{p.decision}</Tag>
              <code>{p.capability}</code>
              <span className="az-list-grow">
                <code>{p.scopePattern}</code>
              </span>
              <span className="az-list-secondary">{p.lifetime}</span>
              <Button
                size="sm"
                variant="danger"
                disabled={revoke.pending}
                onClick={() => void revoke.run({ id: p.id })}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : policies.data ? (
        <EmptyState>
          No standing rules yet. You will be asked the first time the agent wants to change something.
        </EmptyState>
      ) : null}
    </Card>
  );
}
