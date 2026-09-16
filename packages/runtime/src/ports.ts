import { createServer } from "node:net";

export interface PortBand {
  readonly from: number;
  readonly to: number;
}

export const SERVE_BAND: PortBand = { from: 41_000, to: 41_999 };
export const PROXY_BAND: PortBand = { from: 42_000, to: 42_999 };

export interface PortLease {
  readonly port: number;
  readonly band: PortBand;
  readonly owner: string;
  release(): void;
}

/** True when nothing listens on 127.0.0.1:port (and the wildcard address) right now. */
export function isPortFree(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => {
      resolve(false);
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

/**
 * Hands out ports from reserved bands. A port owned by a foreign process is skipped, never killed
 * (ADR-007); the conflict is visible to the caller through `skipped`.
 */
export class PortLeaseRegistry {
  private readonly leased = new Map<number, string>();

  constructor(private readonly probe: (port: number) => Promise<boolean> = isPortFree) {}

  async lease(owner: string, band: PortBand): Promise<PortLease & { skipped: number[] }> {
    const skipped: number[] = [];
    for (let port = band.from; port <= band.to; port++) {
      if (this.leased.has(port)) continue;
      if (!(await this.probe(port))) {
        skipped.push(port);
        continue;
      }
      this.leased.set(port, owner);
      return {
        port,
        band,
        owner,
        skipped,
        release: () => {
          if (this.leased.get(port) === owner) this.leased.delete(port);
        },
      };
    }
    throw new Error(`No free port in ${String(band.from)}–${String(band.to)}`);
  }

  ownerOf(port: number): string | undefined {
    return this.leased.get(port);
  }

  releaseAll(owner: string): void {
    for (const [port, o] of this.leased) if (o === owner) this.leased.delete(port);
  }
}
