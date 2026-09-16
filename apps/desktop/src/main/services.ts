import path from "node:path";
import {
  ALL_CONTRACTS,
  AppError,
  blueprint,
  memory,
  project,
  settings,
  workspace,
} from "@autoappz/contracts";
import { CommandBusHost } from "@autoappz/command-bus";
import type { Logger, Redactor } from "@autoappz/diagnostics";
import {
  BlueprintService,
  BundledTemplateSource,
  ProjectCatalog,
  ProjectMemoryService,
  ProjectSettingsService,
  RequirementsService,
  TemplateRegistry,
} from "@autoappz/project";
import { SecretService, type Cipher } from "@autoappz/secrets";
import type { ProviderRegistry } from "@autoappz/ai-providers";
import { createProviderRegistry, registerProviderHandlers } from "./providers-wiring.ts";
import {
  BlueprintsRepository,
  PLATFORM_DB_FILENAME,
  ProjectMemoryRepository,
  ProjectsRepository,
  RequirementsRepository,
  SecretRefsRepository,
  SettingsRepository,
  SettingsService,
  UsageRecordsRepository,
  openDatabase,
  type DatabaseHandle,
} from "@autoappz/storage";

/** Capabilities only the desktop host can provide (native dialogs, …). Tests pass fakes. */
export interface HostCapabilities {
  pickDirectory(input: {
    title?: string | undefined;
    defaultPath?: string | undefined;
  }): Promise<string | null>;
}

export interface MainServices {
  readonly bus: CommandBusHost;
  readonly db: DatabaseHandle;
  readonly settings: SettingsService;
  readonly secrets: SecretService;
  readonly projects: ProjectCatalog;
  readonly providers: ProviderRegistry;
  close(): void;
}

export interface ServicesOptions {
  logger: Logger;
  redactor: Redactor;
  appVersion: string;
  platform: NodeJS.Platform;
  dataDirectory: string;
  homeDirectory: string;
  /** Directory containing bundled templates (each with a template.json). */
  templatesDir: string;
  /** Overrides the default parent directory for new projects (env AUTOAPPZ_PROJECTS_DIR). */
  projectsDirectoryOverride?: string | undefined;
  sessionId: string;
  cipher: Cipher;
  host: HostCapabilities;
  /** Defaults to `<dataDirectory>/autoappz.db`; ":memory:" for tests. */
  dbPath?: string | undefined;
  now?: (() => number) | undefined;
}

/**
 * Composition root for the main process. Electron-free so it can be exercised in unit and
 * integration tests with a fake cipher, fake host capabilities and an in-memory database.
 */
export function createServices(options: ServicesOptions): MainServices {
  const log = options.logger;
  const db = openDatabase({
    path: options.dbPath ?? path.join(options.dataDirectory, PLATFORM_DB_FILENAME),
    logger: log.child("storage"),
    now: options.now,
  });

  const settingsRepo = new SettingsRepository(db.db, options.now);
  const settingsService = new SettingsService(settingsRepo);
  const secretService = new SecretService({
    refs: new SecretRefsRepository(db.db),
    cipher: options.cipher,
    vaultDir: path.join(options.dataDirectory, "secrets"),
    redactor: options.redactor,
    logger: log.child("secrets"),
    now: options.now,
  });

  const templates = new TemplateRegistry([new BundledTemplateSource(options.templatesDir)]);
  const projects = new ProjectCatalog({
    repo: new ProjectsRepository(db.db),
    templates,
    policy: { dataDirectory: options.dataDirectory, homeDirectory: options.homeDirectory },
    defaultParentDirectory: () =>
      options.projectsDirectoryOverride ??
      settingsService.get().projectsDirectory ??
      path.join(options.homeDirectory, "autoappz-projects"),
    logger: log.child("projects"),
    now: options.now,
  });
  const projectSettings = new ProjectSettingsService(settingsRepo);
  const blueprintsRepo = new BlueprintsRepository(db.db);
  const blueprints = new BlueprintService(blueprintsRepo, options.now);
  const requirements = new RequirementsService(new RequirementsRepository(db.db), blueprintsRepo);
  const projectMemory = new ProjectMemoryService(new ProjectMemoryRepository(db.db), options.now);
  const usageRepo = new UsageRecordsRepository(db.db);
  const providers = createProviderRegistry({
    settingsRepo,
    usageRepo,
    secrets: secretService,
    logger: log.child("providers"),
    now: options.now,
  });

  const bus = new CommandBusHost({
    contracts: ALL_CONTRACTS,
    logger: log.child("bus"),
    onInvalidate: (scopes) => {
      bus.publish(workspace.cacheInvalidate, { scopes: [...scopes] });
    },
  });

  settingsService.onChange((next) => {
    bus.publish(settings.settingsChanged, next);
  });
  projects.onChange((change) => {
    bus.publish(project.projectChanged, change);
  });

  // settings + secrets
  bus.handle(settings.settingsGet, () => settingsService.get());
  bus.handle(settings.settingsUpdate, (patch) => settingsService.update(patch));
  bus.handle(settings.secretsList, async () => [...(await secretService.list())]);
  bus.handle(settings.secretsSet, (input) => secretService.set(input));
  bus.handle(settings.secretsDelete, ({ id }) => secretService.delete(id));
  bus.handle(settings.secretsStorageStatus, () => secretService.storageStatus());
  bus.handle(workspace.workspaceInfo, () => ({
    appVersion: options.appVersion,
    platform: toPlatform(options.platform),
    dataDirectory: options.dataDirectory,
    sessionId: options.sessionId,
  }));

  // projects
  bus.handle(project.projectList, ({ includeArchived }) => projects.list(includeArchived));
  bus.handle(project.projectGet, ({ id }) => projects.get(id));
  bus.handle(project.projectTemplates, () => templates.list());
  bus.handle(project.projectDefaultDirectory, () => ({ path: projects.defaultDirectory() }));
  bus.handle(project.projectCreate, (input) => projects.create(input));
  bus.handle(project.projectImport, (input) => projects.import(input));
  bus.handle(project.projectOpen, ({ id }) => projects.open(id));
  bus.handle(project.projectRename, ({ id, name }) => projects.rename(id, name));
  bus.handle(project.projectDelete, (input) => {
    projects.delete(input);
    projectSettings.remove(input.id);
  });
  bus.handle(project.projectSettingsGet, ({ projectId }) => {
    projects.get(projectId);
    return projectSettings.get(projectId);
  });
  bus.handle(project.projectSettingsUpdate, ({ projectId, patch }) => {
    projects.get(projectId);
    const next = projectSettings.update(projectId, patch);
    if (patch.runtimeProfile !== undefined) projects.setRuntimeProfile(projectId, patch.runtimeProfile);
    return next;
  });
  bus.handle(project.dialogPickDirectory, async (input) => ({
    path: await options.host.pickDirectory(input),
  }));

  // blueprint + requirements
  bus.handle(blueprint.blueprintGet, ({ projectId }) => {
    projects.get(projectId);
    return blueprints.latest(projectId);
  });
  bus.handle(blueprint.blueprintSave, ({ projectId, document, derivedFromTaskId }) => {
    projects.get(projectId);
    return blueprints.save(projectId, document, derivedFromTaskId);
  });
  bus.handle(blueprint.blueprintApprove, ({ projectId, version }) => blueprints.approve(projectId, version));
  bus.handle(blueprint.requirementsList, ({ projectId }) => requirements.list(projectId));
  bus.handle(blueprint.requirementsSync, ({ projectId }) => {
    projects.get(projectId);
    return requirements.sync(projectId);
  });

  // project memory
  bus.handle(memory.memoryList, ({ projectId, includeSuperseded }) =>
    projectMemory.list(projectId, includeSuperseded),
  );
  bus.handle(memory.memoryAdd, (input) => {
    projects.get(input.projectId);
    return projectMemory.add(input);
  });
  bus.handle(memory.memorySupersede, ({ id, statement, confidence }) =>
    projectMemory.supersede(id, statement, confidence),
  );
  bus.handle(memory.memoryDelete, ({ id }) => {
    projectMemory.delete(id);
  });

  registerProviderHandlers(bus, providers, usageRepo);

  const unhandled = bus.unhandledContracts();
  if (unhandled.length > 0) {
    throw new AppError(
      "internal",
      "bus.unhandled_contracts",
      `Contracts without handlers: ${unhandled.join(", ")}`,
    );
  }

  return {
    bus,
    db,
    settings: settingsService,
    secrets: secretService,
    projects,
    providers,
    close() {
      db.close();
    },
  };
}

function toPlatform(p: NodeJS.Platform): "darwin" | "win32" | "linux" {
  if (p === "darwin" || p === "win32") return p;
  return "linux";
}
