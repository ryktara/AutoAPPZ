import { useId, useMemo, useState } from "react";
import { git } from "@autoappz/contracts";
import { Banner, Button, Card, EmptyState, Field, Select, Tag, TextArea, TextInput } from "@autoappz/ui";
import { useCommand, useQuery } from "../../state/hooks.ts";

/** Repository state, user commits, branches and task checkpoints for the Project tab. */
export function GitPanel({ projectId }: { readonly projectId: string }) {
  const input = useMemo(() => ({ projectId }), [projectId]);
  const status = useQuery(git.gitStatus, input);
  const branches = useQuery(git.gitBranches, input);
  const checkpoints = useQuery(
    git.gitCheckpoints,
    useMemo(() => ({ projectId, limit: 20 }), [projectId]),
  );
  const init = useCommand(git.gitInit);
  const commit = useCommand(git.gitCommit);
  const switchBranch = useCommand(git.gitSwitch);
  const branchFrom = useCommand(git.gitBranchFromCheckpoint);
  const ids = { message: useId(), branch: useId(), newBranch: useId() };
  const [message, setMessage] = useState("");
  const [committed, setCommitted] = useState<string | undefined>();
  const [branchName, setBranchName] = useState("");
  const [branchTask, setBranchTask] = useState<string | undefined>();

  if (status.status === "error")
    return <Banner tone="danger">{status.error?.message ?? "Could not read git status."}</Banner>;
  const s = status.data;
  if (!s) return null;
  const error = init.error ?? commit.error ?? switchBranch.error ?? branchFrom.error;

  if (!s.isRepository) {
    return (
      <Card title="Git" description="This project is not a git repository. Checkpoints and undo need one.">
        {error ? <Banner tone="danger">{error.message}</Banner> : null}
        <Button size="sm" disabled={init.pending} onClick={() => void init.run({ projectId })}>
          Initialise repository
        </Button>
      </Card>
    );
  }

  const dirty = s.modified.length + s.untracked.length + s.conflicted.length;
  return (
    <Card
      title="Git"
      description="Every task is snapshotted before it edits and committed with a task trailer when it finishes."
    >
      {error ? <Banner tone="danger">{error.message}</Banner> : null}
      {s.inProgress ? (
        <Banner tone="warning">
          A {s.inProgress} is in progress. Finish or abort it before running tasks.
        </Banner>
      ) : null}
      <div className="az-row" data-testid="git-status">
        <Tag>{s.branch ?? "detached"}</Tag>
        {s.head ? <code>{s.head.slice(0, 10)}</code> : null}
        <span className="az-muted">
          {dirty === 0 ? "Working tree clean" : `${String(dirty)} uncommitted change(s)`}
        </span>
      </div>
      {dirty > 0 ? (
        <ul className="az-list" aria-label="Uncommitted changes">
          {[
            ...s.conflicted.map((p) => ["conflict", p] as const),
            ...s.modified.map((p) => ["modified", p] as const),
            ...s.untracked.map((p) => ["untracked", p] as const),
          ]
            .slice(0, 50)
            .map(([kind, p]) => (
              <li key={`${kind}:${p}`} className="az-list-row">
                <Tag>{kind}</Tag>
                <code className="az-list-grow">{p}</code>
              </li>
            ))}
        </ul>
      ) : null}
      <Field
        label="Commit message"
        htmlFor={ids.message}
        hint="Commits all uncommitted changes. Your git hooks run."
      >
        <TextArea
          id={ids.message}
          rows={2}
          value={message}
          maxLength={4000}
          onChange={(e) => {
            setMessage(e.target.value);
          }}
        />
      </Field>
      <div className="az-row">
        <Button
          size="sm"
          disabled={commit.pending || dirty === 0 || message.trim().length === 0}
          onClick={() =>
            void commit.run({ projectId, message: message.trim() }).then((r) => {
              if (r?.sha) {
                setCommitted(r.sha);
                setMessage("");
              }
            })
          }
        >
          Commit all
        </Button>
        {committed ? <span className="az-muted">Committed {committed.slice(0, 10)}</span> : null}
      </div>
      <Field label="Branch" htmlFor={ids.branch}>
        <Select
          id={ids.branch}
          value={branches.data?.current ?? ""}
          disabled={switchBranch.pending || !branches.data}
          onChange={(e) => void switchBranch.run({ projectId, name: e.target.value })}
        >
          {(branches.data?.branches ?? []).map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
          {branches.data && branches.data.current === undefined ? <option value="">(detached)</option> : null}
        </Select>
      </Field>
      <h4>Checkpoints</h4>
      {(checkpoints.data ?? []).length === 0 ? (
        <EmptyState>No task checkpoints yet.</EmptyState>
      ) : (
        <ul className="az-list" aria-label="Checkpoints">
          {(checkpoints.data ?? []).map((c) => (
            <li key={c.id} className="az-list-row">
              <Tag>{c.resultCommit ? "committed" : (c.taskState ?? "pending")}</Tag>
              <span className="az-list-grow">{c.request ?? c.taskId}</span>
              {c.resultCommit ? <code>{c.resultCommit.slice(0, 10)}</code> : null}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setBranchTask(branchTask === c.taskId ? undefined : c.taskId);
                }}
              >
                Branch from here
              </Button>
            </li>
          ))}
        </ul>
      )}
      {branchTask ? (
        <Field
          label="New branch name"
          htmlFor={ids.newBranch}
          hint="Starts from the snapshot taken before that task ran."
        >
          <div className="az-row">
            <TextInput
              id={ids.newBranch}
              value={branchName}
              maxLength={120}
              onChange={(e) => {
                setBranchName(e.target.value);
              }}
            />
            <Button
              size="sm"
              disabled={branchFrom.pending || branchName.trim().length === 0}
              onClick={() =>
                void branchFrom.run({ taskId: branchTask, name: branchName.trim() }).then((r) => {
                  if (r) {
                    setBranchName("");
                    setBranchTask(undefined);
                  }
                })
              }
            >
              Create branch
            </Button>
          </div>
        </Field>
      ) : null}
    </Card>
  );
}
