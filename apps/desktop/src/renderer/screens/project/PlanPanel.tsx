import { useId, useMemo, useState } from "react";
import { tasks } from "@autoappz/contracts";
import { Banner, Button, Card, EmptyState, Field, Tag, TextArea } from "@autoappz/ui";
import { useCommand, useQuery } from "../../state/hooks.ts";
import type { TaskStreamView } from "../../state/use-task-stream.ts";

/** Plan approval surface: the plan is visible before any file changes when policy requires it. */
export function PlanPanel({
  taskId,
  live,
}: {
  readonly taskId: string | undefined;
  readonly live: TaskStreamView;
}) {
  const task = useQuery(
    tasks.taskGet,
    useMemo(() => ({ taskId: taskId ?? "-" }), [taskId]),
  );
  const approve = useCommand(tasks.taskApprove);
  const revise = useCommand(tasks.taskRevise);
  const reject = useCommand(tasks.taskReject);
  const resume = useCommand(tasks.taskResume);
  const feedbackId = useId();
  const [feedback, setFeedback] = useState("");
  const plan = live.plan ?? (taskId ? task.data?.plan : undefined);
  const state = live.state ?? task.data?.state;
  const error = approve.error ?? revise.error ?? reject.error ?? resume.error;
  const busy = approve.pending || revise.pending || reject.pending;

  if (!taskId) return <EmptyState>Plans appear here once a build request is submitted.</EmptyState>;
  if (!plan) {
    return (
      <div className="az-stack">
        {live.notes.map((n, i) => (
          <p key={i} className="az-muted">
            {n}
          </p>
        ))}
        <EmptyState>
          {state === "PLAN"
            ? "Planning…"
            : state === "INTERRUPTED"
              ? "This task was interrupted."
              : "No plan for this task."}
        </EmptyState>
        {state === "INTERRUPTED" ? (
          <div>
            <Button disabled={resume.pending} onClick={() => void resume.run({ taskId })}>
              Resume (validate what is on disk)
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="az-stack" data-testid="plan">
      {error ? <Banner tone="danger">{error.message}</Banner> : null}
      <Card
        title={plan.revisionOf ? `Plan (revision ${String(plan.revisionOf)})` : "Plan"}
        description={plan.summary}
      >
        <ol className="az-plan-steps">
          {plan.steps.map((s) => (
            <li key={s.id}>
              <div className="az-list-primary">{s.title}</div>
              {s.detail ? <div className="az-list-secondary">{s.detail}</div> : null}
              {s.files.length > 0 ? (
                <div className="az-row">
                  {s.files.map((f) => (
                    <code key={f}>{f}</code>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        {plan.acceptanceCriteria.length > 0 ? (
          <div>
            <div className="az-field-label">Acceptance criteria</div>
            <ul className="az-plain-list">
              {plan.acceptanceCriteria.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {plan.risks.length > 0 ? (
          <div>
            <div className="az-field-label">Risks</div>
            <ul className="az-plain-list">
              {plan.risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {state === "AWAIT_APPROVAL" ? (
        <Card
          title="Approve this plan?"
          description="Nothing changes on disk until you approve. You can ask for changes first."
        >
          <div className="az-row">
            <Button variant="primary" disabled={busy} onClick={() => void approve.run({ taskId })}>
              Approve and build
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void reject.run({ taskId })}>
              Reject
            </Button>
          </div>
          <Field label="Ask for changes" htmlFor={feedbackId}>
            <TextArea
              id={feedbackId}
              rows={3}
              value={feedback}
              onChange={(e) => {
                setFeedback(e.target.value);
              }}
            />
          </Field>
          <div>
            <Button
              disabled={busy || !feedback.trim()}
              onClick={() => {
                void revise.run({ taskId, feedback: feedback.trim() }).then(() => {
                  setFeedback("");
                });
              }}
            >
              Revise plan
            </Button>
          </div>
        </Card>
      ) : (
        <p className="az-muted">
          <Tag>{state ?? "…"}</Tag> {live.notes.at(-1) ?? ""}
        </p>
      )}
    </div>
  );
}
