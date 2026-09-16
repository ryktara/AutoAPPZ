import { ipcMain, type BrowserWindow, type WebContents, type WebFrameMain } from "electron";
import type { PeerInfo, Transport } from "@autoappz/command-bus";
import { BRIDGE_CHANNEL } from "../shared/bridge.ts";

export interface TrustPolicy {
  /** True when the frame is the top-level frame of a known window and its URL is one we loaded. */
  isTrustedFrame(frame: WebFrameMain | null, contents: WebContents): boolean;
}

/** Transport backed by a single ipc channel per BrowserWindow. Trust is decided by the host, never by the message. */
export function createElectronTransport(window: BrowserWindow, policy: TrustPolicy): Transport {
  const peerId = "window-" + String(window.id);
  const handlers = new Set<(m: unknown, p: PeerInfo) => void>();

  const listener = (event: Electron.IpcMainEvent, message: unknown) => {
    if (event.sender.id !== window.webContents.id) return; // another window's traffic
    const peer: PeerInfo = { peerId, trusted: policy.isTrustedFrame(event.senderFrame, event.sender) };
    for (const h of handlers) h(message, peer);
  };
  ipcMain.on(BRIDGE_CHANNEL, listener);

  return {
    send(message) {
      if (window.isDestroyed()) return;
      window.webContents.send(BRIDGE_CHANNEL, message);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close() {
      ipcMain.removeListener(BRIDGE_CHANNEL, listener);
      handlers.clear();
    },
  };
}
