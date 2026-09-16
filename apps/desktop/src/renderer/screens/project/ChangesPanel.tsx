import { diffLines } from "diff";
import { useMemo, useState } from "react";
import { tasks } from "@autoappz/contracts";
import { Banner, EmptyState, Tag } from "@autoappz/ui";
import { useQuery } from "../../state/hooks.ts";

/** Files changed by the active task with a line diff. Undo arrives with git checkpoints (M9). */
export function ChangesPanel({ taskId }: { readonly taskId: string | undefined }) {
  const changes = useQuery(
    tasks.taskChanges,
    useMemo(() => ({ taskId: taskId ?? "-" }), [taskId]),
  );
  const [open, setOpen] = useState<string | undefined>();
  if (!taskId) return <EmptyState>File changes will be listed here.</EmptyState>;
  if (changes.status === "error")
    return <Banner tone="danger">{changes.error?.message ?? "Could not load changes."}</Banner>;
  const list = changes.data ?? [];
  if (list.length === 0) return <EmptyState>No files changed yet.</EmptyState>;
  const selected = list.find((c) => c.path === open) ?? list[0];
  return (
    <div className="az-changes" data-testid="changes">
      <ul className="az-list" aria-label="Changed files">
        {list.map((c) => (
          <li key={c.path} className="az-list-row">
            <Tag>{c.kind}</Tag>
            <button
              type="button"
              className="az-linklike az-list-grow"
              aria-current={selected?.path === c.path ? "true" : undefined}
              onClick={() => {
                setOpen(c.path);
              }}
            >
              <code>{c.path}</code>
            </button>
          </li>
        ))}
      </ul>
      {selected ? <DiffView change={selected} /> : null}
    </div>
  );
}

function DiffView({ change }: { readonly change: tasks.TaskChange }) {
  const parts = useMemo(
    () => diffLines(change.before ?? "", change.after ?? ""),
    [change.before, change.after],
  );
  if (change.truncated)
    return <Banner tone="warning">This file is too large or binary; the diff is not shown.</Banner>;
  return (
    <pre className="az-diff" aria-label={`Diff of ${change.path}`}>
      {parts.map((p, i) => (
        <span key={i} className={p.added ? "az-diff-add" : p.removed ? "az-diff-del" : "az-diff-ctx"}>
          {p.value
            .split("\n")
            .filter((line, idx, arr) => !(idx === arr.length - 1 && line === ""))
            .map((line) => `${p.added ? "+" : p.removed ? "-" : " "} ${line}\n`)
            .join("")}
        </span>
      ))}
    </pre>
  );
}
