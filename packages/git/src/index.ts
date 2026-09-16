export const CHECKPOINT_TRAILER = "AutoAPPZ-Task";
export const CHECKPOINT_REF_PREFIX = "refs/autoappz/checkpoints";

const TASK_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Ref holding the pre-task base commit so every task can be rolled back without touching user branches. */
export function checkpointBaseRef(taskId: string): string {
  if (!TASK_ID.test(taskId)) throw new Error("Invalid task id for ref: " + taskId);
  return CHECKPOINT_REF_PREFIX + "/" + taskId + "/base";
}

/** Append the task trailer to a commit message (idempotent). */
export function withTaskTrailer(message: string, taskId: string): string {
  const line = CHECKPOINT_TRAILER + ": " + taskId;
  if (message.includes(line)) return message;
  const trimmed = message.trimEnd();
  return trimmed + "\n\n" + line + "\n";
}

export interface Checkpoint {
  readonly id: string;
  readonly taskId: string;
  readonly commitSha: string;
  readonly baseSha: string;
  readonly createdAt: number;
  readonly summary: string;
}

export interface VcsProvider {
  isRepository(path: string): Promise<boolean>;
  init(path: string): Promise<void>;
  headSha(path: string): Promise<string | undefined>;
  status(path: string): Promise<{ clean: boolean; changed: readonly string[] }>;
}
