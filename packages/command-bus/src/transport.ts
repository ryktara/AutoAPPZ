import type { WireMessage } from "@autoappz/contracts";

/** Identity of the party at the other end of a transport, as established by the host (never by the message). */
export interface PeerInfo {
  /** Stable id for the peer (e.g. the BrowserWindow id, or "local"). */
  readonly peerId: string;
  /** True when the host verified the peer is a trusted frame (top-level app frame, expected origin). */
  readonly trusted: boolean;
}

/** One endpoint of a bidirectional message channel. */
export interface Transport {
  send(message: WireMessage): void;
  onMessage(handler: (message: unknown, peer: PeerInfo) => void): () => void;
  close(): void;
}

/** In-memory pair of transports; used by tests and by the in-process host mode. */
export function createLocalTransportPair(
  peer: PeerInfo = { peerId: "local", trusted: true },
): [Transport, Transport] {
  const aHandlers = new Set<(m: unknown, p: PeerInfo) => void>();
  const bHandlers = new Set<(m: unknown, p: PeerInfo) => void>();
  let closed = false;

  const make = (
    mine: Set<(m: unknown, p: PeerInfo) => void>,
    theirs: Set<(m: unknown, p: PeerInfo) => void>,
  ): Transport => ({
    send(message) {
      if (closed) return;
      // Structured-clone to emulate a process boundary: no shared references cross.
      const cloned: unknown = structuredClone(message);
      queueMicrotask(() => {
        for (const h of theirs) h(cloned, peer);
      });
    },
    onMessage(handler) {
      mine.add(handler);
      return () => {
        mine.delete(handler);
      };
    },
    close() {
      closed = true;
      mine.clear();
    },
  });

  return [make(aHandlers, bHandlers), make(bHandlers, aHandlers)];
}
