import type { deployment as contracts } from "@autoappz/contracts";
import type { Logger } from "@autoappz/diagnostics";

export type DeploymentAdapterId = contracts.DeploymentAdapterId;
export type DeploymentTarget = contracts.DeploymentTarget;
export type ReadinessItem = contracts.ReadinessItem;
export type DeployEvent = contracts.DeployEvent;

export type Framework = "vite" | "nextjs" | "node" | "static" | "unknown";

export interface FrameworkInfo {
  readonly framework: Framework;
  /** Build output directory relative to the project (for prebuilt/static uploads). */
  readonly outputDir: string;
  readonly hasBuildScript: boolean;
  readonly hasStartScript: boolean;
  /** True when the output is a static site that any static host can serve. */
  readonly static: boolean;
  readonly packageManager: "pnpm" | "npm" | "yarn";
}

export interface DiscoveredSite {
  readonly id: string;
  readonly name: string;
  readonly url?: string | undefined;
  /** Adapter-specific fields the UI writes into `config` when the user picks this site. */
  readonly config: Record<string, string>;
}

export interface DeployInput {
  readonly projectRoot: string;
  readonly target: DeploymentTarget;
  readonly framework: FrameworkInfo;
  /** Resolved provider credential (API token); undefined for adapters without one. */
  readonly secret: string | undefined;
  /** Environment variables to sync to the provider (values already resolved from secrets). */
  readonly env: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly log?: Logger | undefined;
  /** Runs the project's build and reports its lines; adapters that upload prebuilt output call it first. */
  readonly build: () => Promise<{ ok: boolean; outputDir: string }>;
  /** Interval between status polls (tests shorten it). */
  readonly pollIntervalMs?: number | undefined;
  /** Base URL override for provider APIs (tests point this at a mock server). */
  readonly apiBase?: string | undefined;
}

export interface DeploymentAdapter {
  readonly id: DeploymentAdapterId;
  readonly displayName: string;
  /** Credential the target needs; undefined for local adapters (Docker). */
  readonly secret?: { kind: "api-key"; label: string; hint: string } | undefined;
  readonly configFields: readonly {
    key: string;
    label: string;
    required: boolean;
    placeholder?: string | undefined;
  }[];
  /** How the adapter gets the app: source upload (provider builds) or prebuilt output upload or local image. */
  readonly mode: "source" | "prebuilt" | "image";
  discover?(token: string, signal: AbortSignal, apiBase?: string): Promise<DiscoveredSite[]>;
  /** Adapter-specific readiness items (tooling present, config complete). */
  readiness(input: {
    projectRoot: string;
    target: DeploymentTarget;
    framework: FrameworkInfo;
    secret: string | undefined;
  }): Promise<ReadinessItem[]>;
  deploy(input: DeployInput): AsyncIterable<DeployEvent>;
}
