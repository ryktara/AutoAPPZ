import { useMemo } from "react";
import { tasks } from "@autoappz/contracts";
import { Banner, EmptyState } from "@autoappz/ui";
import { useQuery } from "../../state/hooks.ts";
import type { TaskStreamView } from "../../state/use-task-stream.ts";

export function TranscriptPanel({
  projectId,
  activeTaskId,
  live,
}: {
  readonly projectId: string;
  readonly activeTaskId: string | undefined;
  readonly live: TaskStreamView;
}) {
  const sessions = useQuery(
    tasks.sessionList,
    useMemo(() => ({ projectId }), [projectId]),
  );
  const sessionId = sessions.data?.[0]?.id;
  const messages = useQuery(
    tasks.sessionMessages,
    useMemo(() => ({ sessionId: sessionId ?? "-" }), [sessionId]),
  );
  const list = sessionId ? (messages.data ?? []) : [];
  const streaming = activeTaskId !== undefined && !live.done;
  // While a task streams, its final assistant message is not persisted yet; show the live text instead.
  const persistedForActive = activeTaskId
    ? list.some((m) => m.role === "assistant" && m.taskId === activeTaskId)
    : false;

  if (list.length === 0 && !activeTaskId) {
    return <EmptyState>Ask a question about this project to start the transcript.</EmptyState>;
  }

  return (
    <div className="az-transcript" aria-live="polite">
      {list.map((m) => (
        <article key={m.id} className={`az-msg az-msg-${m.role}`} data-role={m.role}>
          <div className="az-msg-role">{m.role === "user" ? "You" : "AutoAPPZ"}</div>
          <div className="az-msg-body">{m.content}</div>
          {m.partial ? <div className="az-field-hint">Stopped early — partial answer.</div> : null}
        </article>
      ))}
      {activeTaskId && !persistedForActive && (live.text || streaming) ? (
        <article className="az-msg az-msg-assistant" data-role="assistant" data-testid="live-answer">
          <div className="az-msg-role">AutoAPPZ</div>
          <div className="az-msg-body">{live.text || <span className="az-muted">…</span>}</div>
        </article>
      ) : null}
      {activeTaskId && live.error ? <Banner tone="danger">{live.error.message}</Banner> : null}
    </div>
  );
}
