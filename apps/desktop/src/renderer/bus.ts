import { CommandBusClient, type Transport } from "@autoappz/command-bus";
import type { AutoappzBridge } from "../shared/bridge.ts";

/** Adapts the preload bridge to the transport the client expects. No Electron types leak past here. */
function bridgeTransport(bridge: AutoappzBridge): Transport {
  return {
    send: (m) => {
      bridge.send(m);
    },
    onMessage: (handler) =>
      bridge.onMessage((m) => {
        handler(m, { peerId: "host", trusted: true });
      }),
    close: () => undefined,
  };
}

export async function connectBus(bridge: AutoappzBridge): Promise<CommandBusClient> {
  const hello = await bridge.hello();
  return new CommandBusClient({
    transport: bridgeTransport(bridge),
    ids: () => ({ sessionId: hello.sessionId }),
    subscriptionToken: hello.subscriptionToken,
  });
}
