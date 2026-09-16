import type { AnyDefinition } from "./definitions.ts";
import * as blueprint from "./domains/blueprint.ts";
import * as memory from "./domains/memory.ts";
import * as project from "./domains/project.ts";
import * as settings from "./domains/settings.ts";
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
