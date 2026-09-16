import { useEffect, useState } from "react";
import { tasks, type AppError } from "@autoappz/contracts";
import { useRuntime } from "./hooks.ts";

export interface ToolActivity {
  readonly callId: string;
  readonly toolId: string;
  readonly description: string;
  readonly status: "running" | "ok" | "error";
  readonly summary: string;
}

export interface TaskStreamView {
  readonly state: tasks.TaskState | undefined;
  readonly model: { providerId: string; modelId: string; reason: string } | undefined;
  readonly text: string;
  readonly reasoning: string;
  readonly plan: tasks.Plan | undefined;
  readonly tools: readonly ToolActivity[];
  readonly notes: readonly string[];
  readonly cost: tasks.TaskCost | undefined;
  readonly error: { message: string; retryable: boolean } | undefined;
  readonly done: boolean;
}

const EMPTY: TaskStreamView = {
  state: undefined,
  model: undefined,
  text: "",
  reasoning: "",
  plan: undefined,
  tools: [],
  notes: [],
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
          if (chunk.kind === "state" || chunk.kind === "done") cache.invalidate(["tasks"]);
          if (chunk.kind === "tool-result") cache.invalidate(["changes", "audit", "permissions"]);
          if (chunk.kind === "done") cache.invalidate(["messages", "sessions", "usage", "changes", "audit"]);
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
    case "plan":
      return { ...v, plan: chunk.plan };
    case "tool-call":
      return {
        ...v,
        tools: [
          ...v.tools,
          {
            callId: chunk.callId,
            toolId: chunk.toolId,
            description: chunk.description,
            status: "running",
            summary: "",
          },
        ],
      };
    case "tool-result":
      return {
        ...v,
        tools: v.tools.map((t) =>
          t.callId === chunk.callId ? { ...t, status: chunk.ok ? "ok" : "error", summary: chunk.summary } : t,
        ),
      };
    case "note":
      return { ...v, notes: [...v.notes, chunk.text] };
    case "usage":
      return { ...v, cost: chunk.cost };
    case "error":
      return { ...v, error: { message: chunk.message, retryable: chunk.retryable } };
    case "done":
      return { ...v, state: chunk.state, done: true };
  }
}
