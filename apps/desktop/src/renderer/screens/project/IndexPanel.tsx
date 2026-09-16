import { useMemo } from "react";
import { context } from "@autoappz/contracts";
import { Banner, Button, Card, Tag } from "@autoappz/ui";
import { useCommand, useQuery } from "../../state/hooks.ts";

/** Code index status for the Project tab: what retrieval and the code tools are working from. */
export function IndexPanel({ projectId }: { readonly projectId: string }) {
  const status = useQuery(
    context.contextStatus,
    useMemo(() => ({ projectId }), [projectId]),
  );
  const reindex = useCommand(context.contextReindex);
  const s = status.data;
  return (
    <Card
      title="Code index"
      description="Local index of your project used to pick relevant excerpts for the model and to power the code search tools. Nothing leaves your machine."
    >
      {status.status === "error" ? <Banner tone="danger">{status.error?.message}</Banner> : null}
      {reindex.error ? <Banner tone="danger">{reindex.error.message}</Banner> : null}
      {s ? (
        <div className="az-row" data-testid="index-status">
          <Tag>{s.state}</Tag>
          <span className="az-muted">
            {String(s.files)} file(s) indexed
            {s.lastFullAt ? ` · full index ${new Date(s.lastFullAt).toLocaleTimeString()}` : ""}
            {s.lastIncrementalAt
              ? ` · last update ${new Date(s.lastIncrementalAt).toLocaleTimeString()}`
              : ""}
          </span>
          {s.error ? <span className="az-danger">{s.error}</span> : null}
        </div>
      ) : null}
      <div className="az-row">
        <Button
          size="sm"
          variant="secondary"
          disabled={reindex.pending || s?.state === "indexing"}
          onClick={() => void reindex.run({ projectId })}
        >
          Rebuild index
        </Button>
      </div>
    </Card>
  );
}
