import type { CommandBusHost } from "@autoappz/command-bus";
import { permissions as contracts } from "@autoappz/contracts";
import type { Logger, Redactor } from "@autoappz/diagnostics";
import { PermissionEngine, type PolicyStore } from "@autoappz/permissions";
import type { PermissionsRepository, ToolCallsRepository } from "@autoappz/storage";
import { FS_TOOLS, ToolRuntime, createSearchTool } from "@autoappz/tools";

export function createPermissionEngine(input: {
  repo: PermissionsRepository;
  bus: CommandBusHost;
  logger: Logger;
  now?: (() => number) | undefined;
  consentTimeoutMs?: number | undefined;
}): PermissionEngine {
  const store: PolicyStore = {
    list: (projectId) => input.repo.list(projectId === "" ? undefined : projectId),
    insert: (p) => {
      input.repo.insert(p);
    },
    delete: (id) => input.repo.delete(id),
  };
  return new PermissionEngine({
    store,
    logger: input.logger,
    now: input.now,
    consentTimeoutMs: input.consentTimeoutMs,
    onConsentRequested: (request) => {
      input.bus.publish(contracts.consentRequested, request);
      input.bus.publish(workspaceInvalidate, { scopes: ["consent"] });
    },
    onConsentResolved: (requestId, choice) => {
      input.bus.publish(contracts.consentResolved, { requestId, choice });
      input.bus.publish(workspaceInvalidate, { scopes: ["consent", "permissions", "audit"] });
    },
  });
}

// Local import to avoid a circular type import at module top.
import { workspace } from "@autoappz/contracts";
const workspaceInvalidate = workspace.cacheInvalidate;

export function createToolRuntime(input: {
  permissions: PermissionEngine;
  audit: ToolCallsRepository;
  redactor: Redactor;
  logger: Logger;
  rgPath?: string | undefined;
  now?: (() => number) | undefined;
}): ToolRuntime {
  return new ToolRuntime({
    tools: [...FS_TOOLS, createSearchTool({ rgPath: input.rgPath })],
    permissions: input.permissions,
    audit: { record: (e) => input.audit.insert(e) },
    redactor: input.redactor,
    logger: input.logger,
    now: input.now,
  });
}

export function registerPermissionHandlers(
  bus: CommandBusHost,
  engine: PermissionEngine,
  audit: ToolCallsRepository,
): void {
  bus.handle(contracts.permissionsPolicies, ({ projectId }) => engine.policies(projectId));
  bus.handle(contracts.permissionsRevoke, ({ id }) => {
    engine.revoke(id);
  });
  bus.handle(contracts.permissionsPending, ({ projectId }) => engine.pending(projectId));
  bus.handle(contracts.permissionsRespond, ({ requestId, choice }) => {
    engine.respond(requestId, choice);
  });
  bus.handle(contracts.toolAudit, ({ taskId }) => audit.list(taskId));
}

/** Resolves the ripgrep binary shipped by @vscode/ripgrep; undefined → Node fallback search. */
export function ripgrepPath(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native-binary package resolved at runtime
    const mod = require("@vscode/ripgrep") as { rgPath?: string };
    return mod.rgPath;
  } catch {
    return undefined;
  }
}
