import { useId, useState } from "react";
import { tasks } from "@autoappz/contracts";
import { Banner, Button, Select, Tag, TextArea } from "@autoappz/ui";
import { useCommand } from "../../state/hooks.ts";
import { useRouter } from "../../state/router.ts";
import type { TaskStreamView } from "../../state/use-task-stream.ts";

const STATE_LABEL: Record<tasks.TaskState, string> = {
  UNDERSTAND: "Understanding",
  EXPLORE: "Exploring",
  PLAN: "Planning",
  AWAIT_APPROVAL: "Waiting for approval",
  EXECUTE: "Working",
  VALIDATE: "Validating",
  DIAGNOSE: "Diagnosing",
  REPAIR: "Repairing",
  REVIEW: "Reviewing",
  CHECKPOINT: "Checkpointing",
  COMPLETE: "Done",
  CANCELLED: "Cancelled",
  NEEDS_USER: "Needs your input",
  INTERRUPTED: "Interrupted",
};

export function RequestPane({
  projectId,
  activeTaskId,
  live,
  onTaskStarted,
}: {
  readonly projectId: string;
  readonly activeTaskId: string | undefined;
  readonly live: TaskStreamView;
  readonly onTaskStarted: (taskId: string) => void;
}) {
  const submit = useCommand(tasks.taskSubmit);
  const cancel = useCommand(tasks.taskCancel);
  const { navigate } = useRouter();
  const ids = { request: useId(), mode: useId() };
  const [request, setRequest] = useState("");
  const [mode, setMode] = useState<tasks.TaskMode>("build");
  const running = activeTaskId !== undefined && !live.done;

  const send = async () => {
    const text = request.trim();
    if (!text) return;
    const result = await submit.run({ projectId, request: text, mode });
    if (result) {
      setRequest("");
      onTaskStarted(result.taskId);
    }
  };

  return (
    <form
      className="az-stack"
      aria-label="Request"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {submit.error ? (
        <Banner tone={submit.error.code === "task.no_provider" ? "warning" : "danger"}>
          {submit.error.message}{" "}
          {submit.error.code === "task.no_provider" ? (
            <Button
              size="sm"
              onClick={() => {
                navigate({ name: "settings" });
              }}
            >
              Open settings
            </Button>
          ) : null}
        </Banner>
      ) : null}
      <label htmlFor={ids.mode} className="az-sr-only">
        Mode
      </label>
      <Select
        id={ids.mode}
        value={mode}
        onChange={(e) => {
          setMode(e.target.value as tasks.TaskMode);
        }}
      >
        <option value="build">Build — plan and change files</option>
        <option value="ask">Ask — answer only, no changes</option>
      </Select>
      <label htmlFor={ids.request} className="az-sr-only">
        Request
      </label>
      <TextArea
        id={ids.request}
        rows={8}
        value={request}
        placeholder={mode === "build" ? "Describe what to build or change…" : "Ask about this project…"}
        disabled={submit.pending}
        onChange={(e) => {
          setRequest(e.target.value);
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="az-row">
        <Button type="submit" variant="primary" disabled={submit.pending || !request.trim()}>
          {submit.pending ? "Sending…" : running ? "Queue" : mode === "build" ? "Build" : "Ask"}
        </Button>
        {running ? (
          <Button
            variant="danger"
            size="sm"
            disabled={cancel.pending}
            onClick={() => void cancel.run({ taskId: activeTaskId })}
          >
            Cancel
          </Button>
        ) : null}
        <span className="az-field-hint">Ctrl/⌘+Enter to send.</span>
      </div>
      {activeTaskId ? (
        <div className="az-task-status" data-testid="task-status">
          {live.state ? <Tag>{STATE_LABEL[live.state]}</Tag> : null}
          {live.model ? (
            <span className="az-muted" title={live.model.reason}>
              {live.model.modelId} · {live.model.providerId}
            </span>
          ) : null}
          {live.cost ? (
            <span className="az-muted">
              {live.cost.inputTokens + live.cost.outputTokens} tokens ·{" "}
              {live.cost.estimatedCostUsd === 0 ? "$0.00" : live.cost.estimatedCostUsd.toFixed(4)}
            </span>
          ) : null}
          {live.error ? <span className="az-danger">{live.error.message}</span> : null}
        </div>
      ) : null}
    </form>
  );
}
