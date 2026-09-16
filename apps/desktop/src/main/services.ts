import path from "node:path";
import { ALL_CONTRACTS, settings, workspace } from "@autoappz/contracts";
import { CommandBusHost } from "@autoappz/command-bus";
import type { Logger, Redactor } from "@autoappz/diagnostics";
import { SecretService, type Cipher } from "@autoappz/secrets";
import {
  PLATFORM_DB_FILENAME,
  SecretRefsRepository,
  SettingsRepository,
  SettingsService,
  openDatabase,
  type DatabaseHandle,
} from "@autoappz/storage";

export interface MainServices {
  readonly bus: CommandBusHost;
  readonly db: DatabaseHandle;
  readonly settings: SettingsService;
  readonly secrets: SecretService;
  close(): void;
}

export interface ServicesOptions {
  logger: Logger;
  redactor: Redactor;
  appVersion: string;
  platform: NodeJS.Platform;
  dataDirectory: string;
  sessionId: string;
  cipher: Cipher;
  /** Defaults to `<dataDirectory>/autoappz.db`; ":memory:" for tests. */
  dbPath?: string | undefined;
  now?: (() => number) | undefined;
}

/**
 * Composition root for the main process. Electron-free so it can be exercised in unit and
 * integration tests with a fake cipher and an in-memory database.
 */
export function createServices(options: ServicesOptions): MainServices {
  const log = options.logger;
  const db = openDatabase({
    path: options.dbPath ?? path.join(options.dataDirectory, PLATFORM_DB_FILENAME),
    logger: log.child("storage"),
    now: options.now,
  });

  const settingsService = new SettingsService(new SettingsRepository(db.db, options.now));
  const secretService = new SecretService({
    refs: new SecretRefsRepository(db.db),
    cipher: options.cipher,
    vaultDir: path.join(options.dataDirectory, "secrets"),
    redactor: options.redactor,
    logger: log.child("secrets"),
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

  const unhandled = bus.unhandledContracts();
  if (unhandled.length > 0) throw new Error(`Contracts without handlers: ${unhandled.join(", ")}`);

  return {
    bus,
    db,
    settings: settingsService,
    secrets: secretService,
    close() {
      db.close();
    },
  };
}

function toPlatform(p: NodeJS.Platform): "darwin" | "win32" | "linux" {
  if (p === "darwin" || p === "win32") return p;
  return "linux";
}
