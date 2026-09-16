import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { project, runtime as runtimeContracts, settings, tasks } from "@autoappz/contracts";
import type { Redactor } from "@autoappz/diagnostics";

export interface DiagnosticsInput {
  readonly dataDirectory: string;
  readonly appVersion: string;
  readonly platform: string;
  readonly settings: settings.UserSettings;
  readonly projects: readonly project.Project[];
  readonly tasksFor: (projectId: string) => readonly tasks.Task[];
  readonly runtimeStatus: (projectId: string) => runtimeContracts.RuntimeStatus;
  readonly tableCounts: () => Record<string, number>;
  readonly redactor: Redactor;
  readonly now?: (() => number) | undefined;
}

const LOG_TAIL_LINES = 2_000;

/**
 * Writes a support bundle under `<dataDir>/diagnostics/bundle-<timestamp>/`. Everything passes through the
 * redactor again (logs are already redacted at write time); secrets, prompts and file contents are never
 * included — only states, versions, counts and error messages.
 */
export function exportDiagnostics(input: DiagnosticsInput): { path: string; files: string[] } {
  const at = input.now?.() ?? Date.now();
  const dir = path.join(
    input.dataDirectory,
    "diagnostics",
    `bundle-${new Date(at).toISOString().replace(/[:.]/g, "-")}`,
  );
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const write = (name: string, content: string) => {
    writeFileSync(path.join(dir, name), input.redactor.redactString(content));
    files.push(name);
  };
  write(
    "system.json",
    JSON.stringify(
      {
        appVersion: input.appVersion,
        platform: input.platform,
        arch: process.arch,
        versions: {
          node: process.versions.node,
          electron: process.versions.electron,
          chrome: process.versions.chrome,
        },
        capturedAt: new Date(at).toISOString(),
        settings: input.settings,
        tableCounts: input.tableCounts(),
      },
      null,
      2,
    ),
  );
  write(
    "projects.json",
    JSON.stringify(
      input.projects.map((p) => ({
        id: p.id,
        name: p.name,
        origin: p.origin,
        templateId: p.templateId,
        runtime: input.runtimeStatus(p.id),
        recentTasks: input.tasksFor(p.id).map((t) => ({
          id: t.id,
          mode: t.mode,
          intent: t.intent,
          complexity: t.complexity,
          state: t.state,
          error: t.error,
          model: t.model,
          cost: t.cost,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
      })),
      null,
      2,
    ),
  );
  const log = path.join(input.dataDirectory, "logs", "main.log");
  if (existsSync(log)) {
    const lines = readFileSync(log, "utf8").split("\n");
    write("main.log", lines.slice(-LOG_TAIL_LINES).join("\n"));
  }
  write(
    "README.txt",
    [
      "AutoAPPZ diagnostics bundle",
      "",
      "Contents: system.json (versions, settings without secrets, database table counts), projects.json (projects, runtime status, recent task states and errors), main.log (last 2000 redacted log lines).",
      "Nothing here contains API keys, connection strings, prompts, model output or your project's file contents. Review before sharing.",
      "",
    ].join("\n"),
  );
  return { path: dir, files };
}
