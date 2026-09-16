import { BrowserWindow, app, session, shell } from "electron";
import path from "node:path";
import type { TrustPolicy } from "./electron-transport.ts";
import { contentSecurityPolicy, isAppUrl, isExternalOpenAllowed, isTrustedFrame } from "./security.ts";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string | undefined;

export const DEV_URL =
  typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === "string" ? MAIN_WINDOW_VITE_DEV_SERVER_URL : undefined;

export function installSessionHardening(): void {
  const s = session.defaultSession;
  s.webRequest.onHeadersReceived((details, callback) => {
    // The strict CSP protects AutoAPPZ's own documents. Previewed apps (loopback proxy origins loaded in
    // the sandboxed iframe) keep their own headers; forcing ours onto them would break their inline
    // dev tooling (e.g. React refresh preambles) without protecting anything of ours.
    if (!isAppUrl(details.url, DEV_URL)) {
      callback({});
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [contentSecurityPolicy(DEV_URL)],
      },
    });
  });
  s.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  s.setPermissionCheckHandler(() => false);
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "AutoAPPZ",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url, DEV_URL)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalOpenAllowed(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  win.once("ready-to-show", () => {
    win.show();
  });

  if (DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    const name = typeof MAIN_WINDOW_VITE_NAME === "string" ? MAIN_WINDOW_VITE_NAME : "main_window";
    void win.loadFile(path.join(__dirname, `../renderer/${name}/index.html`));
  }
  return win;
}

export const trustPolicy: TrustPolicy = {
  isTrustedFrame: (frame, contents) => isTrustedFrame(frame, contents, DEV_URL),
};
