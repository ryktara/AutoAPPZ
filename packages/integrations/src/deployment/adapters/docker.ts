import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AppError } from "@autoappz/contracts";
import { resolveExecutable, runCommand } from "@autoappz/runtime";
import { DOCKERIGNORE, renderDockerfile } from "../dockerfile.ts";
import type { DeployEvent, DeployInput, DeploymentAdapter } from "../types.ts";

export const DOCKER_BUILD_TIMEOUT_MS = 20 * 60_000;

/** Hooks so tests can run the adapter without a Docker daemon. */
export interface DockerAdapterOptions {
  readonly resolveDocker?: (() => { file: string; args: string[] } | undefined) | undefined;
  readonly run?: typeof runCommand | undefined;
}

export function imageTagFor(projectRoot: string, configured: string | undefined): string {
  if (configured) return configured;
  const base =
    // Accept either separator so a Windows project root yields the same tag on every host.
    (projectRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-.]+/, "") || "app";
  return `${base}:latest`;
}

/**
 * Generic Docker: writes a framework-aware Dockerfile (kept in the project, no AutoAPPZ dependency)
 * and builds the image locally with the Docker CLI as an argument array. "Deploying" here means a
 * runnable image plus the `docker run` line; pushing to a registry is the user's call.
 */
export function createDockerAdapter(options: DockerAdapterOptions = {}): DeploymentAdapter {
  const resolveDocker = options.resolveDocker ?? (() => resolveExecutable("docker"));
  const run = options.run ?? runCommand;
  return {
    id: "docker",
    displayName: "Docker image",
    mode: "image",
    configFields: [{ key: "imageTag", label: "Image tag", required: false, placeholder: "my-app:latest" }],
    readiness: ({ projectRoot }) =>
      Promise.resolve([
        resolveDocker()
          ? { id: "docker:cli", label: "Docker CLI", status: "ok" as const, detail: "docker found on PATH" }
          : {
              id: "docker:cli",
              label: "Docker CLI",
              status: "fail" as const,
              detail: "docker is not on PATH.",
              fix: "Install Docker Desktop or the Docker engine and restart AutoAPPZ.",
            },
        existsSync(path.join(projectRoot, "Dockerfile"))
          ? {
              id: "docker:file",
              label: "Dockerfile",
              status: "ok" as const,
              detail: "using the project's Dockerfile",
            }
          : {
              id: "docker:file",
              label: "Dockerfile",
              status: "ok" as const,
              detail: "will be generated for the detected framework",
            },
      ]),
    async *deploy(input: DeployInput): AsyncIterable<DeployEvent> {
      const docker = resolveDocker();
      if (!docker) throw new AppError("precondition", "deploy.docker_missing", "docker is not on PATH.");
      const dockerfile = path.join(input.projectRoot, "Dockerfile");
      if (!existsSync(dockerfile)) {
        yield { kind: "step", name: "Generate Dockerfile", status: "started" };
        writeFileSync(dockerfile, renderDockerfile(input.framework));
        const ignore = path.join(input.projectRoot, ".dockerignore");
        if (!existsSync(ignore)) writeFileSync(ignore, DOCKERIGNORE);
        yield {
          kind: "step",
          name: "Generate Dockerfile",
          status: "done",
          detail: `${input.framework.framework} image`,
        };
      }
      const tag = imageTagFor(input.projectRoot, input.target.config["imageTag"]);
      yield { kind: "step", name: "Build image", status: "started", detail: tag };
      const lines: string[] = [];
      const result = await run({
        file: docker.file,
        args: [...docker.args, "build", "--tag", tag, "."],
        cwd: input.projectRoot,
        timeoutMs: DOCKER_BUILD_TIMEOUT_MS,
        signal: input.signal,
        onLine: (_stream, line) => {
          lines.push(line);
        },
      });
      for (const line of lines.slice(-200)) yield { kind: "log", text: line };
      if (result.exitCode !== 0) {
        yield {
          kind: "step",
          name: "Build image",
          status: "failed",
          detail: result.timedOut ? "timed out" : `exit ${String(result.exitCode)}`,
        };
        throw new AppError(
          "external",
          "deploy.failed",
          result.timedOut
            ? "docker build timed out."
            : `docker build exited with ${String(result.exitCode)}.`,
        );
      }
      yield { kind: "step", name: "Build image", status: "done", detail: tag };
      const envFlags = Object.keys(input.env)
        .map((k) => ` -e ${k}=…`)
        .join("");
      const port = input.framework.static ? "8080:80" : "3000:3000";
      yield { kind: "done", providerRef: tag, hint: `docker run --rm -p ${port}${envFlags} ${tag}` };
    },
  };
}
