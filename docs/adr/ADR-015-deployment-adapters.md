# ADR-015: Deployment adapters, readiness and environment sync

**Status:** Accepted · **Date:** 2026-09-16

## Context

Generated apps must reach production without AutoAPPZ in the loop afterwards (portability), and a deploy must never leak credentials or ship an app that cannot start (missing env, failing build).

## Decision

1. **Adapters call provider REST APIs directly with a stored token**; no vendor CLIs are bundled. `DeploymentAdapter { mode: "source" | "prebuilt" | "image"; discover?; readiness; deploy(): AsyncIterable<DeployEvent> }`:
   - **Vercel** (`source`): uploads project source by SHA1 (never `node_modules`, VCS data, build output or `.env*`), creates a production deployment with a framework preset, polls until `READY`. Env is upserted on the project first.
   - **Netlify** (`prebuilt`): runs the local build, creates a file-digest deploy, uploads only the files Netlify reports as missing, polls until `ready`. Env is set on the site's account scope.
   - **Cloudflare Pages** (`prebuilt`): runs the local build, uploads missing assets by hash with a short-lived upload token, creates a deployment from the manifest, polls the latest stage. Env goes on the project's deployment configs.
   - **Docker** (`image`): writes a framework-aware `Dockerfile` + `.dockerignore` when absent (kept in the project), runs `docker build` as an argument array, returns the image tag and a `docker run` line. Pushing is the user's call.
2. **Readiness gate.** `buildReadiness` (framework, build script, credential, required config, declared env with resolved values, git cleanliness, latest checks) plus adapter items (static-only hosts, Docker CLI). `deploy.run` refuses when any item is `fail`.
3. **Env sync from secrets.** Templates declare `env[]`; a target keeps `name → secretId`. Values are resolved in the main process at deploy time and sent only to the provider; `DATABASE_URL` comes from the attached database integration. `.env*` files are never read.
4. **Journaled runs.** Deployments are records (`deployments` table) with status, URL, provider ref, error and the captured log; events stream live and replay from the record after restart.
5. **Templates carry their Dockerfile** (the same one the Docker target would generate) and CI builds each template's image and runs the portability check (`install && build && test` outside the workspace).

## Alternatives

Bundling vendor CLIs (large, licence and update burden, shell execution); git-push deploys (requires a remote and provider-side build config the user cannot see); a single "static only" adapter (excludes server apps).

## Consequences

Provider request shapes are **UNVERIFIED against live APIs** in this repository — they follow the public references and are exercised by mocked servers in tests; the first live run per provider should be treated as a validation step. Server frameworks cannot use the static hosts (readiness says so). `saas` template deferred: it needs a payments integration design first (tracked in docs/architecture/INTEGRATIONS.md).

## Migration impact

Migration `0006_deployments` adds `deployment_targets` and `deployments`.
