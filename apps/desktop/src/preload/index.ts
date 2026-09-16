import { contextBridge, ipcRenderer } from "electron";
import { BRIDGE_CHANNEL, HELLO_CHANNEL, type AutoappzBridge } from "../shared/bridge.ts";

const bridge: AutoappzBridge = {
  version: process.env["npm_package_version"] ?? "0.0.0",
  send(message) {
    ipcRenderer.send(BRIDGE_CHANNEL, message);
  },
  onMessage(handler) {
    const listener = (_event: Electron.IpcRendererEvent, message: unknown) => {
      handler(message);
    };
    ipcRenderer.on(BRIDGE_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(BRIDGE_CHANNEL, listener);
    };
  },
  hello() {
    return ipcRenderer.invoke(HELLO_CHANNEL) as Promise<{
      sessionId: string;
      subscriptionToken: string;
      peerId: string;
    }>;
  },
};

contextBridge.exposeInMainWorld("autoappz", bridge);
