import type { ProviderRegistry } from "@autoappz/ai-providers";
import type { CommandBusHost } from "@autoappz/command-bus";
import { tasks as contracts, type settings as settingsContracts } from "@autoappz/contracts";
import { ChangeTracker, TaskService, type ProjectContextSource } from "@autoappz/core";
import type { Logger } from "@autoappz/diagnostics";
import type {
  BlueprintService,
  ProjectCatalog,
  ProjectMemoryService,
  ProjectSettingsService,
} from "@autoappz/project";
import {
  MessagesRepository,
  SessionsRepository,
  TaskChangesRepository,
  TaskEventsRepository,
  TasksRepository,
  type PlatformDb,
  type UsageRecordsRepository,
} from "@autoappz/storage";
import type { ToolRuntime } from "@autoappz/tools";

export function createTaskService(input: {
  db: PlatformDb;
  usageRepo: UsageRecordsRepository;
  providers: ProviderRegistry;
  tools: ToolRuntime;
  projects: ProjectCatalog;
  projectSettings: ProjectSettingsService;
  userSettings: () => settingsContracts.UserSettings;
  memory: ProjectMemoryService;
  blueprints: BlueprintService;
  logger: Logger;
  now?: (() => number) | undefined;
}): { service: TaskService; sessions: SessionsRepository; messages: MessagesRepository } {
  const sessions = new SessionsRepository(input.db);
  const messages = new MessagesRepository(input.db);
  const context: ProjectContextSource = {
    project: (id) => input.projects.get(id),
    memory: (id) => input.memory.list(id),
    blueprint: (id) => input.blueprints.latest(id)?.document ?? null,
    approvalThreshold: (id) => {
      const project = input.projectSettings.get(id).autoApprovePlansBelowComplexity;
      return project === "inherit" ? input.userSettings().autoApprovePlansBelowComplexity : project;
    },
  };
  const service = new TaskService({
    tasks: new TasksRepository(input.db),
    events: new TaskEventsRepository(input.db),
    sessions,
    messages,
    usage: input.usageRepo,
    providers: input.providers,
    tools: input.tools,
    changes: new ChangeTracker(new TaskChangesRepository(input.db), input.now),
    context,
    logger: input.logger,
    now: input.now,
  });
  service.recoverInterrupted();
  return { service, sessions, messages };
}

export function registerTaskHandlers(
  bus: CommandBusHost,
  service: TaskService,
  sessions: SessionsRepository,
  messages: MessagesRepository,
): void {
  service.onChange((change) => {
    bus.publish(contracts.taskChanged, change);
  });
  bus.handle(contracts.taskSubmit, (input) => service.submit(input));
  bus.handle(contracts.taskCancel, ({ taskId }) => {
    service.cancel(taskId);
  });
  bus.handle(contracts.taskApprove, ({ taskId }) => {
    service.approve(taskId);
  });
  bus.handle(contracts.taskRevise, ({ taskId, feedback }) => {
    service.revise(taskId, feedback);
  });
  bus.handle(contracts.taskReject, ({ taskId }) => {
    service.reject(taskId);
  });
  bus.handle(contracts.taskResume, ({ taskId }) => {
    service.resume(taskId);
  });
  bus.handle(contracts.taskGet, ({ taskId }) => service.get(taskId));
  bus.handle(contracts.taskList, ({ projectId, limit }) => service.list(projectId, limit));
  bus.handle(contracts.taskChanges, ({ taskId }) => service.changes(taskId));
  bus.handleStream(contracts.taskStream, ({ taskId }, ctx) => service.stream(taskId, ctx.signal));
  bus.handle(contracts.sessionList, ({ projectId }) => sessions.list(projectId));
  bus.handle(contracts.sessionMessages, ({ sessionId }) => messages.list(sessionId));
}
