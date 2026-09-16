import { useMemo } from "react";
import { tasks, validation } from "@autoappz/contracts";
import { Banner, Button, EmptyState, Tag } from "@autoappz/ui";
import { useCommand, useQuery } from "../../state/hooks.ts";
import type { TaskStreamView } from "../../state/use-task-stream.ts";

/**
 * Validation tab: attempts of the active task (streamed while running, persisted afterwards) and
 * on-demand project checks with "Diagnose & fix".
 */
export function ValidationPanel({
  projectId,
  taskId,
  live,
  onTaskStarted,
}: {
  readonly projectId: string;
  readonly taskId: string | undefined;
  readonly live: TaskStreamView;
  readonly onTaskStarted: (taskId: string) => void;
}) {
  const reports = useQuery(
    validation.taskValidation,
    useMemo(() => ({ taskId: taskId ?? "-" }), [taskId]),
  );
  const latest = useQuery(
    validation.validationLatest,
    useMemo(() => ({ projectId }), [projectId]),
  );
  const runChecks = useCommand(validation.validationRun);
  const submit = useCommand(tasks.taskSubmit);
  const running = latest.data?.running === true || runChecks.pending;
  const taskRunning = taskId !== undefined && !live.done;
  const error = runChecks.error ?? submit.error;

  const fix = async () => {
    const result = await submit.run({
      projectId,
      request: "Fix the problems reported by the project checks.",
      mode: "build",
      intent: "fix",
    });
    if (result) onTaskStarted(result.taskId);
  };

  return (
    <div className="az-stack" data-testid="validation">
      {error ? <Banner tone="danger">{error.message}</Banner> : null}
      <div className="az-row">
        <Button
          size="sm"
          variant="secondary"
          disabled={running || taskRunning}
          onClick={() => void runChecks.run({ projectId, tier: 2 })}
        >
          {running ? "Running checks…" : "Run checks"}
        </Button>
        <Button size="sm" disabled={running || taskRunning || submit.pending} onClick={() => void fix()}>
          Diagnose &amp; fix
        </Button>
        <span className="az-muted">
          Syntax, typecheck, lint and related tests over your uncommitted changes.
        </span>
      </div>
      {latest.data?.report ? <ReportView title="Project checks" report={latest.data.report} /> : null}
      {taskId ? (
        <>
          <h4>Task attempts</h4>
          {live.validations.length > 0 ? (
            <ul className="az-list" aria-label="Validation attempts">
              {live.validations.map((v) => (
                <li key={v.attempt} className="az-list-row">
                  <Tag>{v.ok ? "passed" : "failed"}</Tag>
                  <span className="az-list-grow">
                    <div>Attempt {String(v.attempt)}</div>
                    <div className="az-list-secondary">{v.summary}</div>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {(reports.data ?? []).map((r) => (
            <ReportView key={r.attempt} title={`Attempt ${String(r.attempt)}`} report={r} />
          ))}
          {live.validations.length === 0 && (reports.data ?? []).length === 0 ? (
            <EmptyState>
              {taskRunning ? "Checks run after the edits are applied." : "This task did not run any checks."}
            </EmptyState>
          ) : null}
        </>
      ) : (
        <EmptyState>Typecheck, lint, test and build results for each task appear here.</EmptyState>
      )}
    </div>
  );
}

function ReportView({
  title,
  report,
}: {
  readonly title: string;
  readonly report: validation.ValidationReport;
}) {
  return (
    <section className="az-card" aria-label={title}>
      <div className="az-row">
        <strong>{title}</strong>
        <Tag>{report.ok ? "passed" : "failed"}</Tag>
        <span className="az-muted">{String(Math.round(report.durationMs / 100) / 10)} s</span>
      </div>
      <ul className="az-list" aria-label={`${title} validators`}>
        {report.results.map((r) => (
          <li key={r.validator} className="az-list-row">
            <Tag>{r.status}</Tag>
            <code>{r.validator}</code>
            <span className="az-list-grow az-list-secondary">
              {r.note ?? (r.diagnostics.length > 0 ? `${String(r.diagnostics.length)} problem(s)` : "")}
            </span>
          </li>
        ))}
      </ul>
      {report.diagnostics.length > 0 ? (
        <ul className="az-list" aria-label={`${title} problems`}>
          {report.diagnostics.slice(0, 50).map((d, i) => (
            <li key={`${d.file ?? ""}:${String(d.line ?? 0)}:${String(i)}`} className="az-list-row">
              <Tag>{d.severity}</Tag>
              <span className="az-list-grow">
                <div>
                  <code>
                    {d.file ?? "(project)"}
                    {d.line !== undefined ? `:${String(d.line)}` : ""}
                  </code>{" "}
                  {d.code ? <span className="az-muted">{d.code}</span> : null}
                </div>
                <div className="az-list-secondary">{d.message}</div>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
