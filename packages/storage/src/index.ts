export { openDatabase } from "./database.ts";
export type { DatabaseHandle, OpenDatabaseOptions, PlatformDb } from "./database.ts";
export { ALL_MIGRATIONS } from "./migrations/index.ts";
export type { Migration } from "./migration.ts";
export { appliedMigrationIds, pendingMigrations, validateMigrationList } from "./migration.ts";
export { schema } from "./schema.ts";
export type { Schema } from "./schema.ts";
export { SettingsRepository } from "./repositories/settings.ts";
export { SecretRefsRepository } from "./repositories/secret-refs.ts";
export { ProjectsRepository } from "./repositories/projects.ts";
export { BlueprintsRepository, RequirementsRepository } from "./repositories/blueprints.ts";
export { ProjectMemoryRepository } from "./repositories/project-memory.ts";
export { UsageRecordsRepository } from "./repositories/usage-records.ts";
export { PermissionsRepository, ToolCallsRepository } from "./repositories/permissions.ts";
export { CheckpointsRepository } from "./repositories/checkpoints.ts";
export { TaskValidationsRepository } from "./repositories/task-validations.ts";
export {
  MessagesRepository,
  SessionsRepository,
  TaskChangesRepository,
  TaskEventsRepository,
  TasksRepository,
} from "./repositories/tasks.ts";
export type { TaskEventRow } from "./repositories/tasks.ts";
export type { UsageRecordRow } from "./repositories/usage-records.ts";
export { SettingsService } from "./settings-service.ts";
export type { UserSettingsPatch } from "./settings-service.ts";

export const PLATFORM_DB_FILENAME = "autoappz.db";
export const PROJECT_INDEX_DB_FILENAME = "index.db";
