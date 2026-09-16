export type ContextSourceKind = "file" | "symbol" | "blueprint" | "memory" | "diagnostic" | "conversation";

export interface ContextItem {
  readonly id: string;
  readonly kind: ContextSourceKind;
  readonly path: string | undefined;
  readonly content: string;
  readonly tokens: number;
  /** Human-readable reason this item was selected; shown in the context inspector. */
  readonly reason: string;
  readonly score: number;
}

export interface ContextRequest {
  readonly query: string;
  readonly projectId: string;
  readonly budgetTokens: number;
  readonly mustInclude?: readonly string[]; // paths
}

export interface ContextEngine {
  retrieve(request: ContextRequest): Promise<{ items: readonly ContextItem[]; usedTokens: number }>;
  invalidate(projectId: string, paths: readonly string[]): Promise<void>;
}
