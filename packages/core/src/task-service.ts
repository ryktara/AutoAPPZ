import {
  INITIAL_TASK_STATE,
  buildAskSystemPrompt,
  classifyComplexity,
  transition,
  type TaskEvent,
} from "@autoappz/agent";
import type { ChatMessage, ProviderRegistry } from "@autoappz/ai-providers";
import {
  AppError,
  tasks as contracts,
  type blueprint,
  type memory,
  type project,
  type providers,
} from "@autoappz/contracts";
import type { Logger } from "@autoappz/diagnostics";
import type {
  MessagesRepository,
  SessionsRepository,
  TaskEventsRepository,
  TasksRepository,
  UsageRecordsRepository,
} from "@autoappz/storage";
import { TaskEventHub } from "./task-event-hub.ts";

type Task = contracts.Task;
type TaskState = contracts.TaskState;
type TaskStreamChunk = contracts.TaskStreamChunk;

/** What the task runner needs to know about a project; supplied by the composition root. */
export interface ProjectContextSource {
  project(projectId: string): project.Project;
  memory(projectId: string): memory.ProjectMemoryItem[];
  blueprint(projectId: string): blueprint.BlueprintDocument | null;
}

export interface TaskServiceOptions {
  tasks: TasksRepository;
  events: TaskEventsRepository;
  sessions: SessionsRepository;
  messages: MessagesRepository;
  usage: UsageRecordsRepository;
  providers: ProviderRegistry;
  context: ProjectContextSource;
  logger?: Logger | undefined;
  now?: (() => number) | undefined;
  newId?: ((prefix: string) => string) | undefined;
  /** Messages of history sent to the model. */
  historyLimit?: number | undefined;
  hub?: TaskEventHub | undefined;
}

export interface TaskChange {
  taskId: string;
  projectId: string;
  sessionId: string;
  state: TaskState;
}

const MAX_REPAIR_ATTEMPTS = 3;

/**
 * Runs tasks. M4 implements the read-only `ask` flow end to end: journaled transitions, per-session
 * serialisation, streaming through the hub, cancellation, partial persistence and cost accounting.
 */
export class TaskService {
  readonly hub: TaskEventHub;
  private readonly o: TaskServiceOptions;
  private readonly now: () => number;
  private readonly newId: (prefix: string) => string;
  private readonly controllers = new Map<string, AbortController>();
  private readonly sessionQueues = new Map<string, Promise<void>>();
  private readonly listeners = new Set<(change: TaskChange) => void>();

  constructor(options: TaskServiceOptions) {
    this.o = options;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? defaultId;
    this.hub = options.hub ?? new TaskEventHub();
  }

  onChange(listener: (change: TaskChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Marks tasks left live by a previous process as INTERRUPTED. Call once at startup. */
  recoverInterrupted(): Task[] {
    const recovered: Task[] = [];
    for (const task of this.o.tasks.listNonTerminal()) {
      if (task.state === "INTERRUPTED" || task.state === "NEEDS_USER") continue;
      const next = this.apply(task, { type: "process_exit" });
      recovered.push(next);
    }
    if (recovered.length > 0) this.o.logger?.warn("recovered interrupted tasks", { count: recovered.length });
    return recovered;
  }

  submit(input: {
    projectId: string;
    sessionId?: string | undefined;
    request: string;
    mode: contracts.TaskMode;
  }): { taskId: string; sessionId: string } {
    if (input.mode !== "ask") {
      throw new AppError(
        "precondition",
        "task.mode_unsupported",
        "Build tasks arrive in a later milestone; this version answers questions only.",
      );
    }
    const project = this.o.context.project(input.projectId);
    const complexity = classifyComplexity(input.request);
    const route = this.o.providers.route({ intent: intentFor(complexity), complexity });
    if (!route) {
      throw new AppError(
        "precondition",
        "task.no_provider",
        "No model provider is ready. Enable one in Settings → Model providers.",
      );
    }

    const at = this.now();
    const session = this.ensureSession(project, input.sessionId, input.request, at);
    const task: Task = {
      id: this.newId("task"),
      projectId: project.id,
      sessionId: session.id,
      mode: input.mode,
      request: input.request,
      complexity,
      state: INITIAL_TASK_STATE,
      model: { providerId: route.model.providerId, modelId: route.model.modelId },
      cost: { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
      createdAt: at,
      updatedAt: at,
    };
    this.o.tasks.insert(task);
    this.o.events.append({
      taskId: task.id,
      fromState: undefined,
      toState: task.state,
      event: "submit",
      payload: { complexity },
      at,
    });
    this.o.messages.insert({
      id: this.newId("msg"),
      sessionId: session.id,
      role: "user",
      content: input.request,
      taskId: task.id,
      partial: false,
      createdAt: at,
    });
    this.o.sessions.touch(session.id, at);
    this.emitChange(task);
    this.hub.publish(task.id, { kind: "state", state: task.state });
    this.hub.publish(task.id, {
      kind: "model",
      model: { providerId: route.model.providerId, modelId: route.model.modelId },
      reason: route.reason,
    });

    // One task at a time per session so the transcript stays coherent under rapid submits.
    const previous = this.sessionQueues.get(session.id) ?? Promise.resolve();
    const run = previous
      .then(() => this.runAsk(task.id))
      .catch((error: unknown) => {
        this.o.logger?.error("task runner crashed", {
          taskId: task.id,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    this.sessionQueues.set(session.id, run);
    return { taskId: task.id, sessionId: session.id };
  }

  cancel(taskId: string): void {
    const task = this.get(taskId);
    if (contracts.isTerminalTaskState(task.state)) return;
    const controller = this.controllers.get(taskId);
    if (controller) controller.abort();
    else this.finish(task, { type: "cancel" }, "", undefined);
  }

  get(taskId: string): Task {
    const t = this.o.tasks.get(taskId);
    if (!t) throw new AppError("not_found", "task.not_found", "Task not found.", { details: { taskId } });
    return t;
  }

  list(projectId: string, limit?: number): Task[] {
    return this.o.tasks.list(projectId, limit);
  }

  stream(taskId: string, signal: AbortSignal): AsyncIterable<TaskStreamChunk> {
    const task = this.get(taskId);
    if (!this.hub.has(taskId)) {
      // Nothing live: synthesise the terminal picture from the record.
      this.hub.publish(taskId, { kind: "state", state: task.state });
      if (task.model) this.hub.publish(taskId, { kind: "model", model: task.model, reason: "recorded" });
      if (task.error) this.hub.publish(taskId, { kind: "error", message: task.error, retryable: false });
      this.hub.publish(taskId, { kind: "usage", cost: task.cost });
      this.hub.publish(taskId, { kind: "done", state: task.state });
    }
    return this.hub.subscribe(taskId, signal);
  }

  // ---------------------------------------------------------------- run loop

  private async runAsk(taskId: string): Promise<void> {
    let task = this.get(taskId);
    if (task.state !== "UNDERSTAND") return; // cancelled while queued
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    try {
      task = this.apply(task, { type: "context_sufficient" });
      const project = this.o.context.project(task.projectId);
      const system = buildAskSystemPrompt({
        projectName: project.name,
        projectPath: project.path,
        templateId: project.templateId,
        memory: this.o.context.memory(task.projectId),
        blueprint: this.o.context.blueprint(task.projectId),
      });
      const history = this.o.messages.list(task.sessionId).filter((m) => m.role !== "system");
      const historyLimit = this.o.historyLimit ?? 20;
      const messages: ChatMessage[] = [
        { role: "system", content: system },
        ...history
          .slice(-historyLimit)
          .map((m): ChatMessage =>
            m.role === "user"
              ? { role: "user", content: m.content }
              : { role: "assistant", content: m.content },
          ),
      ];

      let text = "";
      let failure: { message: string; retryable: boolean } | undefined;
      const ref = task.model;
      if (!ref) throw new AppError("internal", "task.no_model", "Task has no routed model.");
      for await (const chunk of this.o.providers.chat(
        ref,
        { messages },
        { signal: controller.signal, taskId },
      )) {
        switch (chunk.type) {
          case "text":
            text += chunk.text;
            this.hub.publish(taskId, { kind: "text", delta: chunk.text });
            break;
          case "reasoning":
            this.hub.publish(taskId, { kind: "reasoning", delta: chunk.text });
            break;
          case "tool-call":
            break; // ask tasks declare no tools; ignore defensively
          case "finish":
            break;
          case "error":
            failure = { message: chunk.message, retryable: chunk.retryable };
            break;
        }
        if (failure) break;
      }
      const cost = this.o.usage.summary({ taskId });
      const taskCost: contracts.TaskCost = {
        calls: cost.calls,
        inputTokens: cost.inputTokens,
        outputTokens: cost.outputTokens,
        estimatedCostUsd: cost.estimatedCostUsd,
      };
      this.hub.publish(taskId, { kind: "usage", cost: taskCost });
      task = { ...this.get(taskId), cost: taskCost };

      if (controller.signal.aborted) {
        this.finish(task, { type: "cancel" }, text, undefined);
      } else if (failure) {
        this.hub.publish(taskId, { kind: "error", message: failure.message, retryable: failure.retryable });
        this.finish(task, { type: "failed" }, text, failure.message);
      } else {
        this.finish(task, { type: "answered" }, text, undefined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.hub.publish(taskId, { kind: "error", message, retryable: false });
      this.finish(this.get(taskId), { type: controller.signal.aborted ? "cancel" : "failed" }, "", message);
    } finally {
      this.controllers.delete(taskId);
    }
  }

  private finish(task: Task, event: TaskEvent, text: string, error: string | undefined): void {
    if (contracts.isTerminalTaskState(task.state)) return;
    const at = this.now();
    if (text.length > 0) {
      const partial = event.type !== "answered";
      this.o.messages.insert({
        id: this.newId("msg"),
        sessionId: task.sessionId,
        role: "assistant",
        content: text,
        taskId: task.id,
        partial,
        createdAt: at,
      });
    }
    const next = this.apply({ ...task, ...(error !== undefined ? { error } : {}) }, event, at);
    this.o.sessions.touch(task.sessionId, at);
    this.hub.publish(task.id, { kind: "done", state: next.state });
  }

  /** Applies one event through the pure state machine, journals it, persists and notifies. */
  private apply(task: Task, event: TaskEvent, at = this.now()): Task {
    const result = transition(task.state, event, {
      mode: task.mode,
      repairAttempts: 0,
      maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
    });
    const next: Task = { ...task, state: result.state, updatedAt: at };
    if (
      contracts.isTerminalTaskState(result.state) ||
      result.state === "NEEDS_USER" ||
      result.state === "INTERRUPTED"
    )
      next.terminalAt = at;
    this.o.tasks.update(next);
    this.o.events.append({
      taskId: task.id,
      fromState: task.state,
      toState: result.state,
      event: event.type,
      payload: event.payload,
      at,
    });
    if (result.state !== task.state) {
      this.hub.publish(task.id, { kind: "state", state: result.state });
      this.emitChange(next);
    }
    return next;
  }

  private ensureSession(
    project: project.Project,
    sessionId: string | undefined,
    request: string,
    at: number,
  ): contracts.Session {
    if (sessionId) {
      const s = this.o.sessions.get(sessionId);
      if (s?.projectId !== project.id)
        throw new AppError("not_found", "session.not_found", "Session not found.", {
          details: { sessionId },
        });
      return s;
    }
    const latest = this.o.sessions.latest(project.id);
    if (latest) return latest;
    const s: contracts.Session = {
      id: this.newId("ses"),
      projectId: project.id,
      title: request.slice(0, 60),
      createdAt: at,
      lastActiveAt: at,
    };
    this.o.sessions.insert(s);
    return s;
  }

  private emitChange(task: Task): void {
    for (const l of this.listeners)
      l({ taskId: task.id, projectId: task.projectId, sessionId: task.sessionId, state: task.state });
  }
}

function intentFor(complexity: providers.Complexity): providers.RoutingIntent {
  switch (complexity) {
    case "trivial":
      return "summarize";
    case "standard":
      return "coding";
    case "complex":
      return "review";
  }
}

function defaultId(prefix: string): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = `${prefix}_`;
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
