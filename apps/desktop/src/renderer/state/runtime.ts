import { CommandBusClient, type Transport } from "@autoappz/command-bus";
import type { AutoappzBridge } from "../../shared/bridge.ts";
import { QueryCache } from "./query-cache.ts";

export interface RendererRuntime {
  readonly client: CommandBusClient;
  readonly cache: QueryCache;
}

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

export async function connectRuntime(bridge: AutoappzBridge): Promise<RendererRuntime> {
  const hello = await bridge.hello();
  const cacheRef: { current: QueryCache | undefined } = { current: undefined };
  const client = new CommandBusClient({
    transport: bridgeTransport(bridge),
    ids: () => ({ sessionId: hello.sessionId }),
    subscriptionToken: hello.subscriptionToken,
    onInvalidate: (scopes) => cacheRef.current?.invalidate(scopes),
  });
  const cache = new QueryCache(client);
  cacheRef.current = cache;
  return { client, cache };
}
