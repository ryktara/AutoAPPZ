import { useEffect, useState } from "react";
import { tasks, type AppError } from "@autoappz/contracts";
import { useRuntime } from "./hooks.ts";

export interface TaskStreamView {
  readonly state: tasks.TaskState | undefined;
  readonly model: { providerId: string; modelId: string; reason: string } | undefined;
  readonly text: string;
  readonly reasoning: string;
  readonly cost: tasks.TaskCost | undefined;
  readonly error: { message: string; retryable: boolean } | undefined;
  readonly done: boolean;
}

const EMPTY: TaskStreamView = {
  state: undefined,
  model: undefined,
  text: "",
  reasoning: "",
  cost: undefined,
  error: undefined,
  done: false,
};

/** Subscribes to task.stream for one task and folds chunks into a renderable view. */
export function useTaskStream(taskId: string | undefined): TaskStreamView {
  const { client, cache } = useRuntime();
  const [view, setView] = useState<TaskStreamView>(EMPTY);

  useEffect(() => {
    setView(EMPTY);
    if (!taskId) return;
    const handle = client.stream(
      tasks.taskStream,
      { taskId },
      {
        onChunk: (chunk) => {
          setView((v) => fold(v, chunk));
          if (chunk.kind === "done") cache.invalidate(["messages", "tasks", "sessions", "usage"]);
        },
        onEnd: () => {
          setView((v) => ({ ...v, done: true }));
        },
        onError: (error: AppError) => {
          setView((v) => ({
            ...v,
            done: true,
            error: v.error ?? { message: error.message, retryable: error.retryable },
          }));
        },
      },
    );
    return () => {
      handle.cancel();
    };
  }, [client, cache, taskId]);

  return view;
}

function fold(v: TaskStreamView, chunk: tasks.TaskStreamChunk): TaskStreamView {
  switch (chunk.kind) {
    case "state":
      return { ...v, state: chunk.state };
    case "model":
      return {
        ...v,
        model: { providerId: chunk.model.providerId, modelId: chunk.model.modelId, reason: chunk.reason },
      };
    case "text":
      return { ...v, text: v.text + chunk.delta };
    case "reasoning":
      return { ...v, reasoning: v.reasoning + chunk.delta };
    case "usage":
      return { ...v, cost: chunk.cost };
    case "error":
      return { ...v, error: { message: chunk.message, retryable: chunk.retryable } };
    case "done":
      return { ...v, state: chunk.state, done: true };
  }
}
