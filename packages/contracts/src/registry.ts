import type { AnyDefinition } from "./definitions.ts";
import * as blueprint from "./domains/blueprint.ts";
import * as memory from "./domains/memory.ts";
import * as permissions from "./domains/permissions.ts";
import * as project from "./domains/project.ts";
import * as providers from "./domains/providers.ts";
import * as runtime from "./domains/runtime.ts";
import * as settings from "./domains/settings.ts";
import * as tasks from "./domains/tasks.ts";
import * as workspace from "./domains/workspace.ts";

/**
 * Every contract in the system. The command bus registers handlers against this list,
 * the preload derives its channel allowlist from it, and tests assert one handler per contract.
 */
export const ALL_CONTRACTS: readonly AnyDefinition[] = [
  settings.settingsGet,
  settings.settingsUpdate,
  settings.settingsChanged,
  settings.secretsSet,
  settings.secretsList,
  settings.secretsDelete,
  settings.secretsStorageStatus,
  workspace.workspaceInfo,
  workspace.workspaceReady,
  workspace.cacheInvalidate,
  project.projectList,
  project.projectGet,
  project.projectTemplates,
  project.projectDefaultDirectory,
  project.projectCreate,
  project.projectImport,
  project.projectOpen,
  project.projectRename,
  project.projectDelete,
  project.projectChanged,
  project.projectSettingsGet,
  project.projectSettingsUpdate,
  project.dialogPickDirectory,
  blueprint.blueprintGet,
  blueprint.blueprintSave,
  blueprint.blueprintApprove,
  blueprint.requirementsList,
  blueprint.requirementsSync,
  memory.memoryList,
  memory.memoryAdd,
  memory.memorySupersede,
  memory.memoryDelete,
  providers.providersList,
  providers.providersConfigure,
  providers.providersValidate,
  providers.providersModels,
  providers.providersSettingsGet,
  providers.providersSettingsUpdate,
  providers.providersRoute,
  providers.usageSummary,
  tasks.taskSubmit,
  tasks.taskCancel,
  tasks.taskGet,
  tasks.taskList,
  tasks.taskStream,
  tasks.sessionList,
  tasks.sessionMessages,
  tasks.taskChanged,
  tasks.taskApprove,
  tasks.taskRevise,
  tasks.taskReject,
  tasks.taskResume,
  tasks.taskChanges,
  permissions.permissionsPolicies,
  permissions.permissionsRevoke,
  permissions.permissionsPending,
  permissions.permissionsRespond,
  permissions.consentRequested,
  permissions.consentResolved,
  permissions.toolAudit,
  runtime.runtimeStatus,
  runtime.runtimeStart,
  runtime.runtimeStop,
  runtime.runtimeRestart,
  runtime.runtimeLogs,
  runtime.runtimeDiagnostics,
  runtime.runtimeClearDiagnostics,
  runtime.runtimeReportPreviewEvent,
  runtime.runtimeOutput,
  runtime.runtimeStateChanged,
  runtime.runtimeDiagnostic,
];

export function contractNames(kind?: AnyDefinition["kind"]): readonly string[] {
  return ALL_CONTRACTS.filter((c) => kind === undefined || c.kind === kind).map((c) => c.name);
}

const names = new Set<string>();
for (const contract of ALL_CONTRACTS) {
  if (names.has(contract.name)) {
    throw new Error(`Duplicate contract name: ${contract.name}`);
  }
  names.add(contract.name);
}
