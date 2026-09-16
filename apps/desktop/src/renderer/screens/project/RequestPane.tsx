import { useId, useState } from "react";
import { tasks } from "@autoappz/contracts";
import { Banner, Button, TextArea } from "@autoappz/ui";
import { useCommand } from "../../state/hooks.ts";
import { useRouter } from "../../state/router.ts";
import type { TaskStreamView } from "../../state/use-task-stream.ts";

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
  const id = useId();
  const [request, setRequest] = useState("");
  const running = activeTaskId !== undefined && !live.done;

  const send = async () => {
    const text = request.trim();
    if (!text) return;
    const result = await submit.run({ projectId, request: text, mode: "ask" });
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
      <label htmlFor={id} className="az-sr-only">
        Request
      </label>
      <TextArea
        id={id}
        rows={8}
        value={request}
        placeholder="Ask about this project, or describe what you want to build…"
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
          {submit.pending ? "Sending…" : running ? "Queue" : "Ask"}
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
        <span className="az-field-hint">
          Ctrl/⌘+Enter to send. Questions only in this version; building arrives next.
        </span>
      </div>
    </form>
  );
}
