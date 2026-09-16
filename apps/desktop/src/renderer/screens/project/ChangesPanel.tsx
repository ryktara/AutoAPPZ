import { diffLines } from "diff";
import { useMemo, useState } from "react";
import { git, tasks } from "@autoappz/contracts";
import { Banner, Button, EmptyState, Tag } from "@autoappz/ui";
import { useCommand, useQuery } from "../../state/hooks.ts";

/** Files changed by the active task with a line diff, plus undo/restore backed by the git checkpoint. */
export function ChangesPanel({ taskId }: { readonly taskId: string | undefined }) {
  const changes = useQuery(
    tasks.taskChanges,
    useMemo(() => ({ taskId: taskId ?? "-" }), [taskId]),
  );
  const undo = useCommand(git.gitUndoTask);
  const restore = useCommand(git.gitRestoreFile);
  const [open, setOpen] = useState<string | undefined>();
  const [undoResult, setUndoResult] = useState<git.UndoResult | undefined>();
  if (!taskId) return <EmptyState>File changes will be listed here.</EmptyState>;
  if (changes.status === "error")
    return <Banner tone="danger">{changes.error?.message ?? "Could not load changes."}</Banner>;
  const list = changes.data ?? [];
  if (list.length === 0) return <EmptyState>No files changed yet.</EmptyState>;
  const selected = list.find((c) => c.path === open) ?? list[0];
  const actionError = undo.error ?? restore.error;
  return (
    <div className="az-changes" data-testid="changes">
      {actionError ? <Banner tone="danger">{actionError.message}</Banner> : null}
      {undoResult ? (
        <Banner tone={undoResult.skipped.length > 0 ? "warning" : "info"}>
          Restored {String(undoResult.restored.length)} file(s), removed {String(undoResult.removed.length)}.
          {undoResult.skipped.length > 0
            ? ` Skipped ${String(undoResult.skipped.length)} file(s) you edited after the task: ${undoResult.skipped.join(", ")}.`
            : ""}
        </Banner>
      ) : null}
      <div className="az-row">
        <Button
          size="sm"
          variant="secondary"
          disabled={undo.pending}
          onClick={() =>
            void undo.run({ taskId, force: false }).then((r) => {
              if (r) setUndoResult(r);
            })
          }
        >
          Undo this task
        </Button>
        {undoResult && undoResult.skipped.length > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={undo.pending}
            onClick={() =>
              void undo.run({ taskId, force: true }).then((r) => {
                if (r) setUndoResult(r);
              })
            }
          >
            Undo including my later edits
          </Button>
        ) : null}
      </div>
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
            <Button
              size="sm"
              variant="secondary"
              disabled={restore.pending}
              aria-label={`Restore ${c.path}`}
              onClick={() =>
                void restore.run({ taskId, path: c.path }).then((r) => {
                  if (r) setUndoResult(r);
                })
              }
            >
              Restore
            </Button>
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
