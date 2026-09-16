import type { FrameworkInfo } from "./types.ts";

const NODE_IMAGE = "node:24-alpine";

/** Dockerfile for the detected framework. Generated projects keep it; it has no AutoAPPZ dependency. */
export function renderDockerfile(framework: FrameworkInfo): string {
  const pm = framework.packageManager;
  const install =
    pm === "pnpm"
      ? "RUN corepack enable && pnpm install --frozen-lockfile"
      : pm === "yarn"
        ? "RUN corepack enable && yarn install --frozen-lockfile"
        : "RUN npm ci";
  const run = (script: string) => (pm === "npm" ? `npm run ${script}` : `${pm} run ${script}`);
  const lockfiles = "package.json pnpm-lock.yaml* yarn.lock* package-lock.json* pnpm-workspace.yaml* .npmrc*";
  if (
    framework.framework === "vite" ||
    (framework.framework === "nextjs" && framework.static) ||
    framework.framework === "static"
  ) {
    if (framework.framework === "static") {
      return ["FROM nginx:alpine", "COPY . /usr/share/nginx/html", "EXPOSE 80", ""].join("\n");
    }
    return [
      `FROM ${NODE_IMAGE} AS build`,
      "WORKDIR /app",
      `COPY ${lockfiles} ./`,
      install,
      "COPY . .",
      `RUN ${run("build")}`,
      "",
      "FROM nginx:alpine",
      `COPY --from=build /app/${framework.outputDir} /usr/share/nginx/html`,
      "EXPOSE 80",
      "",
    ].join("\n");
  }
  if (framework.framework === "nextjs") {
    return [
      `FROM ${NODE_IMAGE} AS build`,
      "WORKDIR /app",
      `COPY ${lockfiles} ./`,
      install,
      "COPY . .",
      `RUN ${run("build")}`,
      "",
      `FROM ${NODE_IMAGE}`,
      "WORKDIR /app",
      "ENV NODE_ENV=production",
      "COPY --from=build /app ./",
      "EXPOSE 3000",
      `CMD ["${pm === "npm" ? "npm" : pm}", "run", "start"]`,
      "",
    ].join("\n");
  }
  // Node server (API + built client): build, then run the start script.
  return [
    `FROM ${NODE_IMAGE}`,
    "WORKDIR /app",
    `COPY ${lockfiles} ./`,
    install,
    "COPY . .",
    ...(framework.hasBuildScript ? [`RUN ${run("build")}`] : []),
    "ENV NODE_ENV=production",
    "ENV PORT=3000",
    "EXPOSE 3000",
    `CMD ["${pm === "npm" ? "npm" : pm}", "run", "start"]`,
    "",
  ].join("\n");
}

export const DOCKERIGNORE = [
  "node_modules",
  ".git",
  ".autoappz",
  "dist",
  ".next",
  "out",
  ".env",
  ".env.*",
  "*.log",
  "",
].join("\n");
