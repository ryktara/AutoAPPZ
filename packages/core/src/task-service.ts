import {
  INITIAL_TASK_STATE,
  autoApproves,
  buildAskSystemPrompt,
  buildBuilderSystemPrompt,
  buildPlannerSystemPrompt,
  buildReviewerSystemPrompt,
  classifyComplexity,
  parsePlan,
  parseReview,
  plannerUserMessage,
  profileFor,
  reviewerUserMessage,
  transition,
  type ApprovalThreshold,
  type ProjectPromptContext,
  type TaskEvent,
} from "@autoappz/agent";
import type {
  ChatChunk,
  ChatMessage,
  ProviderRegistry,
  ToolCallRequest,
  ToolCallResult,
} from "@autoappz/ai-providers";
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
import { ReadLedger, type ToolRuntime } from "@autoappz/tools";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ChangeTracker } from "./change-tracker.ts";
import { TaskEventHub } from "./task-event-hub.ts";

type Task = contracts.Task;
type TaskState = contracts.TaskState;
type TaskStreamChunk = contracts.TaskStreamChunk;

/** What the task runner needs to know about a project; supplied by the composition root. */
export interface ProjectContextSource {
  project(projectId: string): project.Project;
  memory(projectId: string): memory.ProjectMemoryItem[];
  blueprint(projectId: string): blueprint.BlueprintDocument | null;
  /** Effective approval threshold for a project (project setting or inherited user setting). */
  approvalThreshold(projectId: string): ApprovalThreshold;
}

/**
 * Version-control port for build tasks (implemented with git in the desktop app). A checkpoint is taken
 * before the first edit; the result is committed with a task trailer once the task completes.
 */
export interface TaskVcs {
  checkpoint(task: {
    id: string;
    projectId: string;
    projectPath: string;
  }): Promise<{ ok: true; skippedLargeFiles: string[] } | { ok: false; reason: string }>;
  commit(
    task: { id: string; projectId: string; projectPath: string },
    message: string,
    paths: readonly string[],
  ): Promise<{ sha: string | undefined }>;
}

/** Retrieved-context port (the context engine in the desktop app). Optional: without it prompts carry only the listing. */
export interface RetrievalSource {
  retrieve(input: {
    projectId: string;
    projectPath: string;
    taskId: string;
    phase: "plan" | "build" | "repair" | "ask";
    query: string;
    selections: readonly string[];
    budgetTokens: number;
  }): { rendered: string; items: ContextItemSummary[]; usedTokens: number; budgetTokens: number };
  /** Files changed by the agent; the index re-reads them and records the activity. */
  notifyChanged(input: {
    projectId: string;
    projectPath: string;
    taskId: string;
    paths: readonly string[];
  }): void;
}

type ContextItemSummary = Extract<TaskStreamChunk, { kind: "context" }>["items"][number];

export interface TaskServiceOptions {
  tasks: TasksRepository;
  events: TaskEventsRepository;
  sessions: SessionsRepository;
  messages: MessagesRepository;
  usage: UsageRecordsRepository;
  providers: ProviderRegistry;
  tools: ToolRuntime;
  changes: ChangeTracker;
  context: ProjectContextSource;
  vcs?: TaskVcs | undefined;
  retrieval?: RetrievalSource | undefined;
  /** Token budget for retrieved excerpts per model step (default 12 000). */
  contextBudgetTokens?: number | undefined;
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
const MAX_REVIEW_ROUNDS = 1;

interface Live {
  controller: AbortController;
  ledger: ReadLedger;
  modelCalls: number;
  toolSteps: number;
  reviewRounds: number;
  /** Resolves when the user approves/revises/rejects. */
  approval?:
    | {
        resolve: (
          decision: { type: "approved" } | { type: "revise"; feedback: string } | { type: "rejected" },
        ) => void;
      }
    | undefined;
  feedback?: string | undefined;
}

/**
 * Runs tasks through the pure state machine with journaled transitions.
 * `ask` tasks answer read-only; `build` tasks plan (optionally gated by approval), execute with tools
 * under the permission engine, validate (validators arrive in M10), review (per profile) and complete.
 */
export class TaskService {
  readonly hub: TaskEventHub;
  private readonly o: TaskServiceOptions;
  private readonly now: () => number;
  private readonly newId: (prefix: string) => string;
  private readonly live = new Map<string, Live>();
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
      recovered.push(this.apply(task, { type: "process_exit" }));
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
    const project = this.o.context.project(input.projectId);
    const complexity = classifyComplexity(input.request);
    const route = this.o.providers.route({
      intent: intentFor(input.mode, complexity),
      complexity,
      requires: input.mode === "build" ? { toolCalling: true } : undefined,
    });
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
      payload: { complexity, mode: input.mode },
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
      .then(() => (input.mode === "ask" ? this.runAsk(task.id) : this.runBuild(task.id)))
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
    const live = this.live.get(taskId);
    if (live) {
      live.approval?.resolve({ type: "rejected" });
      live.controller.abort();
    } else this.finish(task, { type: "cancel" }, "", undefined);
  }

  approve(taskId: string): void {
    this.decide(taskId, { type: "approved" });
  }

  revise(taskId: string, feedback: string): void {
    this.decide(taskId, { type: "revise", feedback });
  }

  reject(taskId: string): void {
    this.decide(taskId, { type: "rejected" });
  }

  /** INTERRUPTED tasks resume into VALIDATE; edits are never re-executed. */
  resume(taskId: string): void {
    const task = this.get(taskId);
    if (task.state !== "INTERRUPTED")
      throw new AppError("precondition", "task.not_interrupted", "Only interrupted tasks can be resumed.");
    const previous = this.sessionQueues.get(task.sessionId) ?? Promise.resolve();
    const run = previous.then(() => this.runFromValidate(taskId, { type: "resume" })).catch(() => undefined);
    this.sessionQueues.set(task.sessionId, run);
  }

  get(taskId: string): Task {
    const t = this.o.tasks.get(taskId);
    if (!t) throw new AppError("not_found", "task.not_found", "Task not found.", { details: { taskId } });
    return t;
  }

  list(projectId: string, limit?: number): Task[] {
    return this.o.tasks.list(projectId, limit);
  }

  changes(taskId: string): contracts.TaskChange[] {
    this.get(taskId);
    return this.o.changes.list(taskId);
  }

  stream(taskId: string, signal: AbortSignal): AsyncIterable<TaskStreamChunk> {
    const task = this.get(taskId);
    if (!this.hub.has(taskId)) {
      this.hub.publish(taskId, { kind: "state", state: task.state });
      if (task.model) this.hub.publish(taskId, { kind: "model", model: task.model, reason: "recorded" });
      if (task.plan) this.hub.publish(taskId, { kind: "plan", plan: task.plan });
      if (task.error) this.hub.publish(taskId, { kind: "error", message: task.error, retryable: false });
      this.hub.publish(taskId, { kind: "usage", cost: task.cost });
      if (
        contracts.isTerminalTaskState(task.state) ||
        task.state === "NEEDS_USER" ||
        task.state === "INTERRUPTED"
      ) {
        this.hub.publish(taskId, { kind: "done", state: task.state });
      }
    }
    return this.hub.subscribe(taskId, signal);
  }

  // ---------------------------------------------------------------- ask

  private async runAsk(taskId: string): Promise<void> {
    let task = this.get(taskId);
    if (task.state !== "UNDERSTAND") return;
    const live = this.start(taskId);
    try {
      task = this.apply(task, { type: "context_sufficient" });
      const project = this.o.context.project(task.projectId);
      const system = buildAskSystemPrompt({
        projectName: project.name,
        projectPath: project.path,
        templateId: project.templateId,
        memory: this.o.context.memory(task.projectId),
        blueprint: this.o.context.blueprint(task.projectId),
        retrieved: this.retrieved(task, "ask", task.request, []),
      });
      const history = this.o.messages.list(task.sessionId).filter((m) => m.role !== "system");
      const messages: ChatMessage[] = [
        { role: "system", content: system },
        ...history
          .slice(-(this.o.historyLimit ?? 20))
          .map((m): ChatMessage =>
            m.role === "user"
              ? { role: "user", content: m.content }
              : { role: "assistant", content: m.content },
          ),
      ];
      const out = await this.modelCall(task, live, messages, undefined);
      this.settle(taskId, live, out.text, out.failure, "answered");
    } catch (error) {
      this.crash(taskId, live, error);
    } finally {
      this.live.delete(taskId);
    }
  }

  // ---------------------------------------------------------------- build

  private async runBuild(taskId: string): Promise<void> {
    let task = this.get(taskId);
    if (task.state !== "UNDERSTAND") return;
    const live = this.start(taskId);
    try {
      const profile = profileFor(task.complexity);
      const ctx = this.promptContext(task);
      task = this.apply(task, { type: "context_sufficient" }); // → PLAN

      if (profile.skipPlan) {
        this.hub.publish(taskId, {
          kind: "note",
          text: "Trivial change: building directly without a separate plan.",
        });
        task = this.apply(task, { type: "plan_skipped" });
      } else {
        for (;;) {
          const plan = await this.planStep(task, live, ctx);
          if (!plan) return; // failed/cancelled handled inside
          task = { ...this.get(taskId), plan };
          this.o.tasks.update(task);
          this.hub.publish(taskId, { kind: "plan", plan });
          const threshold = this.o.context.approvalThreshold(task.projectId);
          if (autoApproves(threshold, task.complexity)) {
            this.hub.publish(taskId, {
              kind: "note",
              text: `Plan auto-approved (project policy: ${threshold}).`,
            });
            task = this.apply(task, { type: "plan_auto_approved" });
            break;
          }
          task = this.apply(task, { type: "plan_ready" }); // → AWAIT_APPROVAL
          const decision = await this.awaitApproval(live);
          if (decision.type === "approved") {
            task = this.apply(task, { type: "approved" });
            break;
          }
          if (decision.type === "rejected") {
            this.finish(
              this.get(taskId),
              { type: live.controller.signal.aborted ? "cancel" : "rejected" },
              "",
              undefined,
            );
            return;
          }
          live.feedback = decision.feedback;
          task = this.apply(task, { type: "revise" }); // → PLAN, loop
        }
      }

      // EXECUTE — snapshot the tree first so every edit can be undone.
      if (!(await this.takeCheckpoint(task, live))) return;
      const summary = await this.builderLoop(task, live, ctx, profile.maxToolSteps);
      if (summary === undefined) return;
      task = this.apply(this.get(taskId), { type: "edits_applied" }); // → VALIDATE
      await this.validateReviewComplete(task, live, ctx, profile.review, summary);
    } catch (error) {
      this.crash(taskId, live, error);
    } finally {
      this.live.delete(taskId);
    }
  }

  private async runFromValidate(taskId: string, event: TaskEvent): Promise<void> {
    const live = this.start(taskId);
    try {
      const task = this.apply(this.get(taskId), event); // INTERRUPTED → VALIDATE
      this.hub.publish(taskId, {
        kind: "note",
        text: "Resumed after interruption: no edits are re-executed; validating what is on disk.",
      });
      await this.validateReviewComplete(
        task,
        live,
        this.promptContext(task),
        "none",
        "Resumed after interruption.",
      );
    } catch (error) {
      this.crash(taskId, live, error);
    } finally {
      this.live.delete(taskId);
    }
  }

  private async validateReviewComplete(
    task: Task,
    live: Live,
    ctx: ProjectPromptContext,
    review: "none" | "full",
    summary: string,
  ): Promise<void> {
    // VALIDATE: validators arrive in M10; today the check set is empty and passes explicitly.
    this.hub.publish(task.id, { kind: "note", text: "No validators configured yet; skipping checks." });
    task = this.apply(task, { type: "checks_passed" }); // → REVIEW

    if (review === "full" && live.reviewRounds < MAX_REVIEW_ROUNDS) {
      const verdict = await this.reviewStep(task, live, ctx);
      if (verdict === undefined) return;
      if (verdict.verdict === "changes" && live.reviewRounds < MAX_REVIEW_ROUNDS) {
        live.reviewRounds += 1;
        this.hub.publish(task.id, {
          kind: "note",
          text: `Reviewer requested changes: ${verdict.notes.join("; ") || "(no notes)"}`,
        });
        task = this.apply(task, { type: "review_requests_changes" }); // → EXECUTE
        const again = await this.builderLoop(
          task,
          live,
          ctx,
          profileFor(task.complexity).maxToolSteps,
          verdict.notes,
        );
        if (again === undefined) return;
        task = this.apply(this.get(task.id), { type: "edits_applied" });
        this.hub.publish(task.id, { kind: "note", text: "No validators configured yet; skipping checks." });
        task = this.apply(task, { type: "checks_passed" });
        summary = again;
      }
    }
    task = this.apply(task, { type: "review_passed" }); // → CHECKPOINT
    await this.commitCheckpoint(task, summary);
    // CHECKPOINT → COMPLETE happens in finish() via checkpoint_created, together with the summary message.
    this.settle(task.id, live, summary, undefined, "answered", true);
  }

  private async takeCheckpoint(task: Task, live: Live): Promise<boolean> {
    if (!this.o.vcs) return true;
    const project = this.o.context.project(task.projectId);
    try {
      const result = await this.o.vcs.checkpoint({
        id: task.id,
        projectId: task.projectId,
        projectPath: project.path,
      });
      if (result.ok) {
        if (result.skippedLargeFiles.length > 0) {
          this.hub.publish(task.id, {
            kind: "note",
            text: `Checkpoint created; ${String(result.skippedLargeFiles.length)} file(s) over the size cap were left out.`,
          });
        }
        return true;
      }
      this.hub.publish(task.id, {
        kind: "note",
        text: `No checkpoint: ${result.reason}. Undo will not be available for this task.`,
      });
      return true;
    } catch (error) {
      // A refused checkpoint (merge in progress, git failure) must stop the task before any edit happens.
      const message = error instanceof AppError ? error.message : String(error);
      this.hub.publish(task.id, { kind: "error", message, retryable: true });
      this.finish(
        this.get(task.id),
        { type: live.controller.signal.aborted ? "cancel" : "failed" },
        "",
        message,
      );
      return false;
    }
  }

  private async commitCheckpoint(task: Task, summary: string): Promise<void> {
    if (!this.o.vcs) return;
    const paths = [...new Set(this.o.changes.list(task.id).map((c) => c.path))];
    if (paths.length === 0) return;
    const project = this.o.context.project(task.projectId);
    const firstLine =
      summary
        .split("\n")
        .find((l) => l.trim().length > 0)
        ?.trim() ?? task.request;
    const message = firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
    try {
      const { sha } = await this.o.vcs.commit(
        { id: task.id, projectId: task.projectId, projectPath: project.path },
        message,
        paths,
      );
      if (sha)
        this.hub.publish(task.id, {
          kind: "note",
          text: `Committed ${String(paths.length)} file(s) as ${sha.slice(0, 10)}.`,
        });
    } catch (error) {
      // The edits are on disk and recorded; a failed commit is reported, not fatal.
      const message = error instanceof AppError ? error.message : String(error);
      this.o.logger?.warn("task commit failed", { taskId: task.id, message });
      this.hub.publish(task.id, { kind: "note", text: `Changes were not committed: ${message}` });
    }
  }

  private async planStep(
    task: Task,
    live: Live,
    ctx: ProjectPromptContext,
  ): Promise<contracts.Plan | undefined> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildPlannerSystemPrompt({
          ...ctx,
          retrieved: this.retrieved(task, "plan", task.request, pathsMentioned(task.request)),
        }),
      },
      { role: "user", content: plannerUserMessage(task.request, live.feedback) },
    ];
    const out = await this.modelCall(task, live, messages, undefined, { silentText: true });
    if (out.failure || live.controller.signal.aborted) {
      this.settle(task.id, live, "", out.failure ?? { message: "Cancelled.", retryable: false }, "answered");
      return undefined;
    }
    try {
      const plan = parsePlan(out.text);
      if (live.feedback !== undefined) plan.revisionOf = (task.plan?.revisionOf ?? 0) + 1;
      return plan;
    } catch (error) {
      this.settle(
        task.id,
        live,
        "",
        {
          message: `The planner did not return a valid plan: ${error instanceof Error ? error.message : String(error)}`,
          retryable: true,
        },
        "answered",
      );
      return undefined;
    }
  }

  private awaitApproval(
    live: Live,
  ): Promise<{ type: "approved" } | { type: "revise"; feedback: string } | { type: "rejected" }> {
    return new Promise((resolve) => {
      live.approval = { resolve };
      if (live.controller.signal.aborted) resolve({ type: "rejected" });
    });
  }

  private decide(
    taskId: string,
    decision: { type: "approved" } | { type: "revise"; feedback: string } | { type: "rejected" },
  ): void {
    const task = this.get(taskId);
    if (task.state !== "AWAIT_APPROVAL")
      throw new AppError(
        "precondition",
        "task.not_awaiting_approval",
        "This task is not waiting for approval.",
      );
    const live = this.live.get(taskId);
    if (!live?.approval)
      throw new AppError("precondition", "task.not_live", "This task is no longer running; resubmit it.");
    live.approval.resolve(decision);
    live.approval = undefined;
  }

  /** Tool loop: model ↔ tools until the model stops calling tools or the step budget is hit. */
  private async builderLoop(
    task: Task,
    live: Live,
    ctx: ProjectPromptContext,
    maxToolSteps: number,
    reviewNotes?: string[],
  ): Promise<string | undefined> {
    const plan = this.get(task.id).plan;
    const tools = this.o.tools.specs();
    const planFiles = plan
      ? [...new Set(plan.steps.flatMap((st) => st.files))]
      : pathsMentioned(task.request);
    const phase = reviewNotes && reviewNotes.length > 0 ? "repair" : "build";
    const query = plan
      ? [task.request, plan.summary, ...plan.steps.map((st) => st.title)].join("\n")
      : task.request;
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildBuilderSystemPrompt(
          { ...ctx, retrieved: this.retrieved(task, phase, query, planFiles) },
          plan,
        ),
      },
      { role: "user", content: task.request },
    ];
    if (reviewNotes && reviewNotes.length > 0)
      messages.push({
        role: "user",
        content: `The reviewer requested changes:\n- ${reviewNotes.join("\n- ")}`,
      });
    const project = this.o.context.project(task.projectId);

    for (;;) {
      const out = await this.modelCall(task, live, messages, tools);
      if (out.failure) {
        this.settle(task.id, live, out.text, out.failure, "answered");
        return undefined;
      }
      if (live.controller.signal.aborted) {
        this.settle(task.id, live, out.text, undefined, "answered");
        return undefined;
      }
      if (out.toolCalls.length === 0) return out.text || "Done.";

      messages.push({ role: "assistant", content: out.text, toolCalls: out.toolCalls });
      const results: ToolCallResult[] = [];
      for (const call of out.toolCalls) {
        if (live.toolSteps >= maxToolSteps) {
          this.settle(
            task.id,
            live,
            out.text,
            {
              message: `Step budget of ${String(maxToolSteps)} tool calls reached. Resume with a narrower request or raise the budget.`,
              retryable: true,
            },
            "answered",
          );
          return undefined;
        }
        live.toolSteps += 1;
        const toolId = call.name;
        const description = describeCall(toolId, call.input);
        this.hub.publish(task.id, { kind: "tool-call", callId: call.id, toolId, description });
        const paths = ChangeTracker.pathsOf(toolId, call.input);
        if (paths.length > 0) this.o.changes.before(task.id, project.path, paths);
        const result = await this.o.tools.execute({
          toolId,
          input: call.input,
          projectId: task.projectId,
          projectRoot: project.path,
          taskId: task.id,
          signal: live.controller.signal,
          ledger: live.ledger,
        });
        if (paths.length > 0) {
          this.o.changes.after(task.id, project.path, paths);
          if (result.ok)
            this.o.retrieval?.notifyChanged({
              projectId: task.projectId,
              projectPath: project.path,
              taskId: task.id,
              paths,
            });
        }
        this.hub.publish(task.id, {
          kind: "tool-result",
          callId: call.id,
          toolId,
          ok: result.ok,
          summary: result.summaryForModel.slice(0, 400),
        });
        results.push({ id: call.id, name: toolId, output: result.summaryForModel, isError: !result.ok });
      }
      messages.push({ role: "tool", results });
      if (live.modelCalls >= profileFor(task.complexity).maxModelCalls) {
        this.settle(
          task.id,
          live,
          "",
          { message: "Model call budget reached for this task.", retryable: true },
          "answered",
        );
        return undefined;
      }
    }
  }

  private async reviewStep(
    task: Task,
    live: Live,
    ctx: ProjectPromptContext,
  ): Promise<{ verdict: "pass" | "changes"; notes: string[] } | undefined> {
    const messages: ChatMessage[] = [
      { role: "system", content: buildReviewerSystemPrompt(ctx) },
      { role: "user", content: reviewerUserMessage(task.request, task.plan, this.o.changes.list(task.id)) },
    ];
    const out = await this.modelCall(task, live, messages, undefined, { silentText: true });
    if (out.failure || live.controller.signal.aborted) {
      this.settle(task.id, live, "", out.failure ?? { message: "Cancelled.", retryable: false }, "answered");
      return undefined;
    }
    try {
      return parseReview(out.text);
    } catch {
      this.hub.publish(task.id, { kind: "note", text: "Reviewer returned no verdict; treating as pass." });
      return { verdict: "pass", notes: [] };
    }
  }

  // ---------------------------------------------------------------- shared

  private async modelCall(
    task: Task,
    live: Live,
    messages: ChatMessage[],
    tools: ReturnType<ToolRuntime["specs"]> | undefined,
    options: { silentText?: boolean } = {},
  ): Promise<{
    text: string;
    toolCalls: ToolCallRequest[];
    failure: { message: string; retryable: boolean } | undefined;
  }> {
    const ref = task.model;
    if (!ref) throw new AppError("internal", "task.no_model", "Task has no routed model.");
    live.modelCalls += 1;
    let text = "";
    const toolCalls: ToolCallRequest[] = [];
    let failure: { message: string; retryable: boolean } | undefined;
    const chunks: AsyncIterable<ChatChunk> = this.o.providers.chat(
      ref,
      { messages, tools },
      { signal: live.controller.signal, taskId: task.id },
    );
    for await (const chunk of chunks) {
      switch (chunk.type) {
        case "text":
          text += chunk.text;
          if (!options.silentText) this.hub.publish(task.id, { kind: "text", delta: chunk.text });
          break;
        case "reasoning":
          this.hub.publish(task.id, { kind: "reasoning", delta: chunk.text });
          break;
        case "tool-call":
          toolCalls.push(chunk.call);
          break;
        case "finish":
          break;
        case "error":
          failure = { message: chunk.message, retryable: chunk.retryable };
          break;
      }
      if (failure) break;
    }
    this.publishUsage(task.id);
    return { text, toolCalls, failure };
  }

  private publishUsage(taskId: string): contracts.TaskCost {
    const s = this.o.usage.summary({ taskId });
    const cost: contracts.TaskCost = {
      calls: s.calls,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      estimatedCostUsd: s.estimatedCostUsd,
    };
    this.hub.publish(taskId, { kind: "usage", cost });
    const t = this.o.tasks.get(taskId);
    if (t) this.o.tasks.update({ ...t, cost });
    return cost;
  }

  /** Ends a run: persists the assistant message (partial when cancelled/failed) and applies the terminal event. */
  private settle(
    taskId: string,
    live: Live,
    text: string,
    failure: { message: string; retryable: boolean } | undefined,
    successEvent: "answered",
    alreadyComplete = false,
  ): void {
    const task = this.get(taskId);
    if (live.controller.signal.aborted) {
      this.finish(task, { type: "cancel" }, text, undefined);
    } else if (failure) {
      this.hub.publish(taskId, { kind: "error", message: failure.message, retryable: failure.retryable });
      this.finish(task, { type: "failed" }, text, failure.message);
    } else if (alreadyComplete) {
      this.finish(task, { type: successEvent }, text, undefined);
    } else {
      this.finish(task, { type: successEvent }, text, undefined);
    }
  }

  private crash(taskId: string, live: Live, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.o.logger?.error("task failed", { taskId, message });
    this.hub.publish(taskId, { kind: "error", message, retryable: false });
    const task = this.get(taskId);
    if (!contracts.isTerminalTaskState(task.state))
      this.finish(task, { type: live.controller.signal.aborted ? "cancel" : "failed" }, "", message);
  }

  private start(taskId: string): Live {
    const live: Live = {
      controller: new AbortController(),
      ledger: new ReadLedger(),
      modelCalls: 0,
      toolSteps: 0,
      reviewRounds: 0,
    };
    this.live.set(taskId, live);
    return live;
  }

  private finish(task: Task, event: TaskEvent, text: string, error: string | undefined): void {
    if (contracts.isTerminalTaskState(task.state)) return;
    const at = this.now();
    if (text.length > 0) {
      const partial = event.type !== "answered" && event.type !== "checkpoint_created";
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
    const current = this.get(task.id);
    // CHECKPOINT → COMPLETE uses checkpoint_created; everything else maps through the machine as given.
    const effective: TaskEvent =
      current.state === "CHECKPOINT" && event.type === "answered" ? { type: "checkpoint_created" } : event;
    const next = this.apply(
      { ...current, cost: task.cost, ...(error !== undefined ? { error } : {}) },
      effective,
      at,
    );
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

  /** Retrieves excerpts for a model step, publishes the "why included" chunk and returns the rendered block. */
  private retrieved(
    task: Task,
    phase: "plan" | "build" | "repair" | "ask",
    query: string,
    selections: readonly string[],
  ): string | undefined {
    if (!this.o.retrieval) return undefined;
    const project = this.o.context.project(task.projectId);
    try {
      const pack = this.o.retrieval.retrieve({
        projectId: task.projectId,
        projectPath: project.path,
        taskId: task.id,
        phase,
        query,
        selections,
        budgetTokens: this.o.contextBudgetTokens ?? 12_000,
      });
      this.hub.publish(task.id, {
        kind: "context",
        phase,
        items: pack.items,
        usedTokens: pack.usedTokens,
        budgetTokens: pack.budgetTokens,
      });
      return pack.rendered || undefined;
    } catch (error) {
      // Retrieval is an optimisation: a failure degrades to the plain listing and is reported, not fatal.
      this.o.logger?.warn("context retrieval failed", {
        taskId: task.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private promptContext(task: Task): ProjectPromptContext {
    const project = this.o.context.project(task.projectId);
    return {
      project,
      memory: this.o.context.memory(task.projectId),
      blueprint: this.o.context.blueprint(task.projectId),
      fileListing: listTopLevel(project.path),
    };
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

function intentFor(mode: contracts.TaskMode, complexity: providers.Complexity): providers.RoutingIntent {
  if (mode === "build") return complexity === "complex" ? "planning" : "coding";
  switch (complexity) {
    case "trivial":
      return "summarize";
    case "standard":
      return "coding";
    case "complex":
      return "review";
  }
}

function describeCall(toolId: string, input: unknown): string {
  const i = input as Record<string, unknown> | null;
  const p =
    typeof i?.["path"] === "string"
      ? i["path"]
      : typeof i?.["from"] === "string"
        ? i["from"]
        : typeof i?.["query"] === "string"
          ? `"${i["query"]}"`
          : "";
  return p ? `${toolId} ${p}` : toolId;
}

/** Project-relative paths the user named in a request (e.g. `src/App.tsx`). */
export function pathsMentioned(text: string): string[] {
  const out = new Set<string>();
  const pattern =
    /(?:^|[\s`"'(])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8}|[\w.-]+\.(?:tsx?|jsx?|css|scss|json|md|html|ya?ml|sql))(?=$|[\s`"'),.;:])/g;
  for (const m of text.matchAll(pattern)) {
    const p = m[1];
    if (p && !p.startsWith("/") && !p.includes("..")) out.add(p.replace(/\\/g, "/"));
  }
  return [...out];
}

function listTopLevel(root: string): string {
  try {
    const skip = new Set(["node_modules", ".git", "dist", ".vite"]);
    const out: string[] = [];
    for (const name of readdirSync(root).sort()) {
      if (skip.has(name)) continue;
      const isDir = statSync(join(root, name)).isDirectory();
      out.push(isDir ? `${name}/` : name);
      if (isDir && out.length < 80) {
        for (const child of readdirSync(join(root, name)).sort().slice(0, 40)) out.push(`${name}/${child}`);
      }
      if (out.length > 200) break;
    }
    return out.join("\n");
  } catch {
    return "(unavailable)";
  }
}

function defaultId(prefix: string): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = `${prefix}_`;
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
