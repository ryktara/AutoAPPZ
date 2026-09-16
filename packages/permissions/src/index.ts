export type PermissionLifetime = "once" | "session" | "project" | "deny";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface PermissionRequest {
  readonly capability: string; // e.g. "fs.write", "shell.run", "network.fetch"
  readonly scope: string; // e.g. project id, path glob, host
  readonly risk: RiskLevel;
  readonly reason: string;
  readonly taskId: string;
}

export interface PermissionDecision {
  readonly granted: boolean;
  readonly lifetime: PermissionLifetime;
  readonly decidedAt: number;
  readonly source: "user" | "policy" | "cached";
}

export interface PermissionService {
  check(request: PermissionRequest): Promise<PermissionDecision>;
  revoke(capability: string, scope: string): Promise<void>;
}
