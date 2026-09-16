import { ALL_CONTRACTS, settings, workspace } from "@autoappz/contracts";

type UserSettings = settings.UserSettings;
import { CommandBusHost } from "@autoappz/command-bus";
import type { Logger } from "@autoappz/diagnostics";

export interface MainServices {
  readonly bus: CommandBusHost;
}

/**
 * Composition root for the main process. M0 wires in-memory settings and workspace info so the
 * window can round-trip a query; persistent services replace these in M1/M2.
 */
export function createServices(input: {
  logger: Logger;
  appVersion: string;
  platform: NodeJS.Platform;
  dataDirectory: string;
  sessionId: string;
}): MainServices {
  const bus = new CommandBusHost({
    contracts: ALL_CONTRACTS,
    logger: input.logger.child("bus"),
    onInvalidate: (scopes) => {
      bus.publish(workspace.cacheInvalidate, { scopes: [...scopes] });
    },
  });

  let current: UserSettings = settings.UserSettingsSchema.parse({});

  bus.handle(settings.settingsGet, () => current);
  bus.handle(settings.settingsUpdate, (patch) => {
    current = settings.UserSettingsSchema.parse({ ...current, ...patch });
    bus.publish(settings.settingsChanged, current);
    return current;
  });
  bus.handle(settings.secretsList, () => []);
  bus.handle(settings.secretsSet, () => {
    throw new Error("Secret storage arrives in M1.");
  });
  bus.handle(settings.secretsDelete, () => {
    throw new Error("Secret storage arrives in M1.");
  });
  bus.handle(workspace.workspaceInfo, () => ({
    appVersion: input.appVersion,
    platform: toPlatform(input.platform),
    dataDirectory: input.dataDirectory,
    sessionId: input.sessionId,
  }));

  const unhandled = bus.unhandledContracts();
  if (unhandled.length > 0) throw new Error("Contracts without handlers: " + unhandled.join(", "));

  return { bus };
}

function toPlatform(p: NodeJS.Platform): "darwin" | "win32" | "linux" {
  if (p === "darwin" || p === "win32") return p;
  return "linux";
}
