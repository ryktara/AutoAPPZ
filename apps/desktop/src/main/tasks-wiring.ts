import type { ProviderRegistry } from "@autoappz/ai-providers";
import type { CommandBusHost } from "@autoappz/command-bus";
import { tasks as contracts } from "@autoappz/contracts";
import { TaskService, type ProjectContextSource } from "@autoappz/core";
import type { Logger } from "@autoappz/diagnostics";
import type { BlueprintService, ProjectCatalog, ProjectMemoryService } from "@autoappz/project";
import {
  MessagesRepository,
  SessionsRepository,
  TaskEventsRepository,
  TasksRepository,
  type PlatformDb,
  type UsageRecordsRepository,
} from "@autoappz/storage";

export function createTaskService(input: {
  db: PlatformDb;
  usageRepo: UsageRecordsRepository;
  providers: ProviderRegistry;
  projects: ProjectCatalog;
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
  };
  const service = new TaskService({
    tasks: new TasksRepository(input.db),
    events: new TaskEventsRepository(input.db),
    sessions,
    messages,
    usage: input.usageRepo,
    providers: input.providers,
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
  bus.handle(contracts.taskGet, ({ taskId }) => service.get(taskId));
  bus.handle(contracts.taskList, ({ projectId, limit }) => service.list(projectId, limit));
  bus.handleStream(contracts.taskStream, ({ taskId }, ctx) => service.stream(taskId, ctx.signal));
  bus.handle(contracts.sessionList, ({ projectId }) => sessions.list(projectId));
  bus.handle(contracts.sessionMessages, ({ sessionId }) => messages.list(sessionId));
}
