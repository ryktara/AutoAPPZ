import type { Migration } from "../migration.ts";
import { m0001Initial } from "./0001_initial.ts";

/** Append only. Never edit a shipped migration; add a new one. */
export const ALL_MIGRATIONS: readonly Migration[] = [m0001Initial];
