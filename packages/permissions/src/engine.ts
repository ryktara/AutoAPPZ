import { AppError, type permissions as contracts } from "@autoappz/contracts";
import type { Logger } from "@autoappz/diagnostics";
import { globMatch, patternSpecificity } from "./glob.ts";

type Capability = contracts.Capability;
type RiskTier = contracts.RiskTier;
type Policy = contracts.Policy;
type ConsentRequest = contracts.ConsentRequest;
type ConsentChoice = contracts.ConsentChoice;
type DecisionSource = contracts.DecisionSource;

export interface PolicyStore {
  list(projectId: string): Policy[];
  insert(policy: Policy): void;
  delete(id: string): boolean;
}

export interface PermissionCheck {
  readonly projectId: string;
  readonly taskId: string;
  readonly toolId: string;
  readonly capability: Capability;
  /** Concrete scope value, e.g. "src/App.tsx", "api.github.com", "pnpm". */
  readonly scope: string;
  readonly risk: RiskTier;
  /** Default when no policy matches: `allow` only for low-risk reads inside the project. */
  readonly defaultPolicy: "allow" | "ask" | "deny";
  readonly description: string;
  readonly preview?: string | undefined;
  readonly signal: AbortSignal;
}

export interface PermissionDecision {
  readonly decision: "allow" | "deny";
  readonly source: DecisionSource;
  readonly policyId?: string | undefined;
}

export interface PermissionEngineOptions {
  store: PolicyStore;
  /** Fired when a call is parked; the UI shows a consent sheet. */
  onConsentRequested?: ((request: ConsentRequest) => void) | undefined;
  onConsentResolved?:
    ((requestId: string, choice: ConsentChoice | "timeout" | "cancelled") => void) | undefined;
  consentTimeoutMs?: number | undefined;
  logger?: Logger | undefined;
  now?: (() => number) | undefined;
  newId?: (() => string) | undefined;
}

interface Parked {
  readonly request: ConsentRequest;
  readonly check: PermissionCheck;
  readonly resolve: (decision: PermissionDecision) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Decision procedure (docs/security/PERMISSIONS.md):
 * explicit deny wins → most specific project policy → session policy → once policy (consumed) →
 * tool default → park for consent (deadline, cancellable). Destructive actions never auto-allow.
 */
export class PermissionEngine {
  private readonly store: PolicyStore;
  private readonly session: Policy[] = [];
  private readonly parked = new Map<string, Parked>();
  private readonly log: Logger | undefined;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly timeoutMs: number;
  private readonly onRequested: ((request: ConsentRequest) => void) | undefined;
  private readonly onResolved:
    ((requestId: string, choice: ConsentChoice | "timeout" | "cancelled") => void) | undefined;

  constructor(options: PermissionEngineOptions) {
    this.store = options.store;
    this.log = options.logger;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? defaultId;
    this.timeoutMs = options.consentTimeoutMs ?? 5 * 60_000;
    this.onRequested = options.onConsentRequested;
    this.onResolved = options.onConsentResolved;
  }

  async check(input: PermissionCheck): Promise<PermissionDecision> {
    const at = this.now();
    const matching = (policies: readonly Policy[]) =>
      policies
        .filter((p) => p.capability === input.capability && (p.expiresAt === undefined || p.expiresAt > at))
        .filter((p) => p.projectId === undefined || p.projectId === input.projectId)
        .filter((p) => globMatch(p.scopePattern, input.scope))
        .sort((a, b) => patternSpecificity(b.scopePattern) - patternSpecificity(a.scopePattern));

    const project = matching(this.store.list(input.projectId));
    const session = matching(this.session);

    // 1. Explicit deny anywhere wins.
    const deny = [...project, ...session].find((p) => p.decision === "deny");
    if (deny) return { decision: "deny", source: "deny_rule", policyId: deny.id };

    // 2. Standing allows, most specific first; `once` policies are consumed.
    const projectAllow = project.find((p) => p.decision === "allow");
    if (projectAllow) return { decision: "allow", source: "policy_project", policyId: projectAllow.id };
    const sessionAllow = session.find((p) => p.decision === "allow");
    if (sessionAllow) {
      if (sessionAllow.lifetime === "once") this.session.splice(this.session.indexOf(sessionAllow), 1);
      return {
        decision: "allow",
        source: sessionAllow.lifetime === "once" ? "policy_once" : "policy_session",
        policyId: sessionAllow.id,
      };
    }

    // 3. Defaults. Destructive never auto-allows.
    if (input.defaultPolicy === "deny") return { decision: "deny", source: "default" };
    if (input.defaultPolicy === "allow" && input.risk !== "destructive")
      return { decision: "allow", source: "default" };

    // 4. Park for consent.
    return this.park(input);
  }

  pending(projectId?: string): ConsentRequest[] {
    return [...this.parked.values()]
      .map((p) => p.request)
      .filter((r) => projectId === undefined || r.projectId === projectId);
  }

  respond(requestId: string, choice: ConsentChoice): void {
    const parked = this.parked.get(requestId);
    if (!parked)
      throw new AppError(
        "not_found",
        "permissions.request_not_found",
        "This consent request is no longer pending.",
      );
    this.settle(parked, choice);
  }

  /** Standing policies for the UI (project ones from the store plus live session rules). */
  policies(projectId?: string): Policy[] {
    const stored = projectId === undefined ? this.store.list("") : this.store.list(projectId);
    return [...stored, ...this.session.filter((p) => projectId === undefined || p.projectId === projectId)];
  }

  revoke(id: string): void {
    const i = this.session.findIndex((p) => p.id === id);
    if (i >= 0) {
      this.session.splice(i, 1);
      return;
    }
    if (!this.store.delete(id))
      throw new AppError("not_found", "permissions.policy_not_found", "Policy not found.", {
        details: { id },
      });
  }

  private park(input: PermissionCheck): Promise<PermissionDecision> {
    const at = this.now();
    const request: ConsentRequest = {
      id: this.newId(),
      projectId: input.projectId,
      taskId: input.taskId,
      toolId: input.toolId,
      capability: input.capability,
      scope: input.scope,
      risk: input.risk,
      description: input.description,
      requestedAt: at,
      deadlineAt: at + this.timeoutMs,
    };
    if (input.preview !== undefined) request.preview = input.preview;
    return new Promise<PermissionDecision>((resolve) => {
      const timer = setTimeout(() => {
        const p = this.parked.get(request.id);
        if (p) this.finish(p, { decision: "deny", source: "timeout" }, "timeout");
      }, this.timeoutMs);
      timer.unref?.();
      const parked: Parked = { request, check: input, resolve, timer };
      this.parked.set(request.id, parked);
      input.signal.addEventListener(
        "abort",
        () => {
          const p = this.parked.get(request.id);
          if (p) this.finish(p, { decision: "deny", source: "cancelled" }, "cancelled");
        },
        { once: true },
      );
      this.log?.info("consent requested", {
        requestId: request.id,
        toolId: input.toolId,
        capability: input.capability,
        scope: input.scope,
        risk: input.risk,
      });
      this.onRequested?.(request);
    });
  }

  private settle(parked: Parked, choice: ConsentChoice): void {
    const { check } = parked;
    if (choice === "deny") {
      this.finish(parked, { decision: "deny", source: "user" }, choice);
      return;
    }
    const at = this.now();
    if (choice === "allow_once") {
      this.finish(parked, { decision: "allow", source: "user" }, choice);
      return;
    }
    const policy: Policy = {
      id: this.newId(),
      projectId: check.projectId,
      capability: check.capability,
      scopePattern: scopePatternFor(check.capability, check.scope),
      decision: "allow",
      lifetime: choice === "allow_session" ? "session" : "project",
      createdAt: at,
    };
    if (choice === "allow_session") this.session.push(policy);
    else this.store.insert(policy);
    this.finish(parked, { decision: "allow", source: "user", policyId: policy.id }, choice);
  }

  private finish(
    parked: Parked,
    decision: PermissionDecision,
    choice: ConsentChoice | "timeout" | "cancelled",
  ): void {
    clearTimeout(parked.timer);
    this.parked.delete(parked.request.id);
    this.log?.info("consent resolved", { requestId: parked.request.id, choice });
    this.onResolved?.(parked.request.id, choice);
    parked.resolve(decision);
  }
}

/**
 * The standing rule created from a single consent. Paths widen to the containing directory so
 * "allow this project" covers sibling edits without becoming `**`; other scopes stay exact.
 */
export function scopePatternFor(capability: Capability, scope: string): string {
  if (capability.startsWith("fs.")) {
    const idx = scope.lastIndexOf("/");
    return idx <= 0 ? "*" : `${scope.slice(0, idx)}/**`;
  }
  return scope;
}

function defaultId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = "perm_";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
