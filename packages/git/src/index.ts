export { createGitClient, SAFE_INSPECT_ARGS, tempIndexDir } from "./client.ts";
export type { GitClient, GitExecOptions, GitResult } from "./client.ts";
export {
  CHECKPOINT_REF_PREFIX,
  CHECKPOINT_TRAILER,
  GitService,
  MAX_SNAPSHOT_FILE_BYTES,
  checkpointBaseRef,
  inProgressOperation,
  parsePorcelainV2,
  withTaskTrailer,
} from "./service.ts";
export type { CheckpointResult, GitServiceOptions, UndoResult } from "./service.ts";
