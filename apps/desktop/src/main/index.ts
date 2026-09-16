import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLoggerRoot, jsonLineSink, parseLogLevel } from "@autoappz/diagnostics";
import { HELLO_CHANNEL } from "../shared/bridge.ts";
import { createElectronTransport } from "./electron-transport.ts";
import { createServices } from "./services.ts";
import { createMainWindow, installSessionHardening, trustPolicy } from "./window.ts";

const dataDirectory = process.env["AUTOAPPZ_DATA_DIR"] ?? path.join(app.getPath("userData"));
const sessionId = randomUUID();
const { logger } = createLoggerRoot({
  level: parseLogLevel(process.env["AUTOAPPZ_LOG_LEVEL"], app.isPackaged ? "info" : "debug"),
  sinks: [jsonLineSink(process.stdout)],
});

app.setAsDefaultProtocolClient("autoappz");

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
    const services = createServices({
      logger,
      appVersion: app.getVersion(),
      platform: process.platform,
      dataDirectory,
      sessionId,
    });

    const openWindow = () => {
      const win = createMainWindow();
      const peerId = "window-" + String(win.id);
      const transport = createElectronTransport(win, trustPolicy);
      const detach = services.bus.attach(peerId, transport);
      const subscriptionToken = services.bus.issueSubscriptionToken(peerId);

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
}
