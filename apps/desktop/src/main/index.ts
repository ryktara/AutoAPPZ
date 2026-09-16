import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { createWriteStream, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLoggerRoot, jsonLineSink, parseLogLevel, Redactor, type LogSink } from "@autoappz/diagnostics";
import { HELLO_CHANNEL } from "../shared/bridge.ts";
import { createElectronTransport } from "./electron-transport.ts";
import { createSafeStorageCipher } from "./safe-storage-cipher.ts";
import { createServices, type HostCapabilities, type MainServices } from "./services.ts";
import { linuxPasswordStore } from "./security.ts";
import { createMainWindow, installSessionHardening, trustPolicy } from "./window.ts";

const dataDirectory = process.env["AUTOAPPZ_DATA_DIR"] ?? app.getPath("userData");
const sessionId = randomUUID();
const redactor = new Redactor();
const sinks: LogSink[] = [];
if (!app.isPackaged) sinks.push(jsonLineSink(process.stdout));
try {
  mkdirSync(path.join(dataDirectory, "logs"), { recursive: true });
  sinks.push(jsonLineSink(createWriteStream(path.join(dataDirectory, "logs", "main.log"), { flags: "a" })));
} catch {
  // logging to disk is best-effort
}
const { logger } = createLoggerRoot({
  level: parseLogLevel(process.env["AUTOAPPZ_LOG_LEVEL"], app.isPackaged ? "info" : "debug"),
  sinks,
  redactor,
});

/** Bundled templates: `resources/templates` when packaged, the repository folder in dev. */
function templatesDirectory(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "templates")
    : path.resolve(app.getAppPath(), "..", "..", "templates");
}

let services: MainServices | undefined;

app.setAsDefaultProtocolClient("autoappz");

const passwordStore = linuxPasswordStore(process.env, process.platform);
if (passwordStore !== undefined) app.commandLine.appendSwitch("password-store", passwordStore);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (e, url) => {
      if (!url.startsWith("file://") && !url.startsWith("http://localhost")) e.preventDefault();
    });
  });

  void app.whenReady().then(() => {
    installSessionHardening();

    const host: HostCapabilities = {
      // Only http(s) URLs leave the app; anything else is refused before reaching the OS.
      openExternal: (url) =>
        /^https?:\/\//.test(url)
          ? shell.openExternal(url)
          : Promise.reject(new Error("Refusing to open a non-http URL.")),
      async pickDirectory(input) {
        const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const opts: Electron.OpenDialogOptions = {
          properties: ["openDirectory", "createDirectory"],
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.defaultPath !== undefined ? { defaultPath: input.defaultPath } : {}),
        };
        const result = owner ? await dialog.showOpenDialog(owner, opts) : await dialog.showOpenDialog(opts);
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
    };

    try {
      const cipher = createSafeStorageCipher();
      services = createServices({
        logger,
        redactor,
        appVersion: app.getVersion(),
        platform: process.platform,
        dataDirectory,
        homeDirectory: homedir(),
        templatesDir: templatesDirectory(),
        projectsDirectoryOverride: process.env["AUTOAPPZ_PROJECTS_DIR"],
        sessionId,
        cipher,
        host,
      });
      logger.info("secure storage", { backend: cipher.backend, available: cipher.isAvailable() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("bootstrap failed", { message });
      dialog.showErrorBox("AutoAPPZ could not start", message);
      app.exit(1);
      return;
    }
    logger.info("services ready", { dataDirectory, sessionId });

    const bus = services.bus;
    const openWindow = () => {
      const win = createMainWindow();
      const peerId = `window-${String(win.id)}`;
      const transport = createElectronTransport(win, trustPolicy);
      const detach = bus.attach(peerId, transport);
      const subscriptionToken = bus.issueSubscriptionToken(peerId);

      const hello = (event: Electron.IpcMainInvokeEvent) => {
        if (
          event.sender.id !== win.webContents.id ||
          !trustPolicy.isTrustedFrame(event.senderFrame, event.sender)
        ) {
          throw new Error("untrusted hello");
        }
        return { sessionId, subscriptionToken, peerId };
      };
      ipcMain.handle(HELLO_CHANNEL, hello);

      win.on("closed", () => {
        ipcMain.removeHandler(HELLO_CHANNEL);
        detach();
      });
      logger.info("window opened", { peerId });
    };

    openWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting || !services) return;
    event.preventDefault();
    quitting = true;
    const pending = services;
    services = undefined;
    void Promise.race([pending.close(), new Promise((r) => setTimeout(r, 8_000))]).finally(() => {
      logger.info("shutdown");
      app.quit();
    });
  });
}
