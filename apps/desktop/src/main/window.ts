import { BrowserWindow, app, shell, session, type WebContents, type WebFrameMain } from "electron";
import path from "node:path";
import type { TrustPolicy } from "./electron-transport.ts";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string | undefined;

const DEV_URL =
  typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === "string" ? MAIN_WINDOW_VITE_DEV_SERVER_URL : undefined;

/** Content Security Policy for the renderer. No remote scripts, no eval, no inline scripts. */
export function contentSecurityPolicy(): string {
  const connect = DEV_URL ? "'self' ws: http://localhost:*" : "'self'";
  const script = DEV_URL ? "'self' 'unsafe-inline'" : "'self'"; // vite dev needs inline for HMR client
  return [
    "default-src 'self'",
    "script-src " + script,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src " + connect,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");
}

export function installSessionHardening(): void {
  const s = session.defaultSession;
  s.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [contentSecurityPolicy()] },
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
    if (!isAppUrl(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
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
    void win.loadFile(path.join(__dirname, "../renderer/" + name + "/index.html"));
  }
  return win;
}

function isAppUrl(url: string): boolean {
  if (DEV_URL && url.startsWith(DEV_URL)) return true;
  return url.startsWith("file://");
}

export const trustPolicy: TrustPolicy = {
  isTrustedFrame(frame: WebFrameMain | null, contents: WebContents): boolean {
    if (!frame) return false;
    if (frame !== contents.mainFrame) return false; // only the top-level frame
    return isAppUrl(frame.url);
  },
};
