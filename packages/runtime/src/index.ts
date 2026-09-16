export { buildChildEnv, detectPackageManager, resolveCmdShim, resolveExecutable } from "./command.ts";
export type { ResolvedCommand } from "./command.ts";
export { PROXY_BAND, PortLeaseRegistry, SERVE_BAND, isPortFree } from "./ports.ts";
export type { PortBand, PortLease } from "./ports.ts";
export { LineSplitter, OutputRing, stripAnsi } from "./output.ts";
export { extractDiagnostic } from "./diagnostics.ts";
export type { Extracted } from "./diagnostics.ts";
export { httpProbe, isAlive, killTree } from "./process.ts";
export {
  PREVIEW_SCRIPT_PATH,
  PREVIEW_SCRIPT_VERSION,
  injectScript,
  previewScript,
  startPreviewProxy,
} from "./proxy.ts";
export type { PreviewProxy } from "./proxy.ts";
export { RuntimeSupervisor } from "./supervisor.ts";
export type { CommandPlanner, PhaseCommand, SupervisorOptions } from "./supervisor.ts";

/** Fixed budgets per phase (docs/architecture/RUNTIME.md). */
export const PHASE_TIMEOUTS_MS = {
  install: 15 * 60_000,
  build: 10 * 60_000,
  test: 20 * 60_000,
  serve: 3 * 60_000,
  script: 10 * 60_000,
} as const;
