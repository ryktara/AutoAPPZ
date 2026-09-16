/**
 * The only surface the preload exposes to the renderer (window.autoappz).
 * Deliberately tiny: opaque messages in/out plus a one-time handshake.
 */
export interface AutoappzBridge {
  readonly version: string;
  send(message: unknown): void;
  onMessage(handler: (message: unknown) => void): () => void;
  hello(): Promise<{ sessionId: string; subscriptionToken: string; peerId: string }>;
}

export const BRIDGE_CHANNEL = "autoappz:bus";
export const HELLO_CHANNEL = "autoappz:hello";

declare global {
  interface Window {
    autoappz?: AutoappzBridge;
  }
}
