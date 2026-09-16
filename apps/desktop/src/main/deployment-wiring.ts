import type { CommandBusHost } from "@autoappz/command-bus";
import { AppError, deployment as contracts, workspace } from "@autoappz/contracts";
import type { Logger } from "@autoappz/diagnostics";
import type { GitService } from "@autoappz/git";
import {
  buildReadiness,
  createDeploymentAdapters,
  deploymentAdapter,
  detectFramework,
  type DeployEvent,
  type DeploymentAdapter,
  type DeploymentTarget,
} from "@autoappz/integrations";
import type { ProjectCatalog, ProjectSettingsService, TemplateRegistry } from "@autoappz/project";
import { detectPackageManager, resolveExecutable, runCommand, PHASE_TIMEOUTS_MS } from "@autoappz/runtime";
import type { SecretService } from "@autoappz/secrets";
import type { DeploymentTargetsRepository, DeploymentsRepository } from "@autoappz/storage";

type DeploymentRecord = contracts.DeploymentRecord;

interface LiveDeployment {
  readonly events: DeployEvent[];
  readonly listeners: Set<(event: DeployEvent | null) => void>;
  readonly controller: AbortController;
  finished: boolean;
}

export interface DeploymentWiring {
  close(): Promise<void>;
}

/**
 * Deployment hub: targets, env sync from secrets, readiness, and background deployments whose events are
 * journaled in memory while running and persisted (status, url, log) when they finish.
 */
export function createDeploymentWiring(input: {
  bus: CommandBusHost;
  targets: DeploymentTargetsRepository;
  deployments: DeploymentsRepository;
  secrets: SecretService;
  projects: ProjectCatalog;
  projectSettings: ProjectSettingsService;
  templates: TemplateRegistry;
  git: GitService;
  /** DATABASE_URL for the project when a database is attached (integrations wiring). */
  databaseUrlFor: (projectId: string) => Promise<string | undefined>;
  /** Latest validation summary for the readiness checklist, if known. */
  lastValidation?: ((projectId: string) => { ok: boolean; summary: string } | undefined) | undefined;
  logger: Logger;
  now?: (() => number) | undefined;
  newId?: ((prefix: string) => string) | undefined;
  adapters?: readonly DeploymentAdapter[] | undefined;
}): DeploymentWiring {
  const now = input.now ?? Date.now;
  const newId =
    input.newId ??
    ((prefix: string) => `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
  const adapters = input.adapters ?? createDeploymentAdapters();
  const live = new Map<string, LiveDeployment>();

  const changed = (projectId: string) => {
    input.bus.publish(contracts.deployChanged, { projectId });
    input.bus.publish(workspace.cacheInvalidate, { scopes: ["deploy"] });
  };
  const targetOf = (id: string): DeploymentTarget => {
    const t = input.targets.get(id);
    if (!t)
      throw new AppError("not_found", "deploy.target_not_found", "Deployment target not found.", {
        details: { id },
      });
    return t;
  };

  /** Env the app declares (template manifest) plus DATABASE_URL when a database is attached. */
  const envRequirements = async (projectId: string, target: DeploymentTarget) => {
    const project = input.projects.get(projectId);
    const template = project.templateId
      ? input.templates.list().find((t) => t.id === project.templateId)
      : undefined;
    const declared = template?.env ?? [];
    const dbUrl = await input.databaseUrlFor(projectId);
    const names = new Set<string>([...declared.map((e) => e.name), ...Object.keys(target.envSecrets)]);
    if (dbUrl) names.add("DATABASE_URL");
    const out: {
      name: string;
      required: boolean;
      resolved: boolean;
      source?: string;
      description?: string;
      value?: string;
    }[] = [];
    for (const name of names) {
      const spec = declared.find((e) => e.name === name);
      const secretId = target.envSecrets[name];
      const fromSecret = secretId ? await input.secrets.resolve({ id: secretId }) : undefined;
      const value = fromSecret ?? (name === "DATABASE_URL" ? dbUrl : undefined);
      out.push({
        name,
        required: spec?.required ?? false,
        resolved: value !== undefined,
        ...(fromSecret !== undefined
          ? { source: "secret" }
          : value !== undefined
            ? { source: "attached database" }
            : {}),
        ...(spec?.description !== undefined ? { description: spec.description } : {}),
        ...(value !== undefined ? { value } : {}),
      });
    }
    return out;
  };

  const readiness = async (target: DeploymentTarget) => {
    const project = input.projects.get(target.projectId);
    const adapter = deploymentAdapter(adapters, target.adapterId);
    const framework = detectFramework(project.path);
    const secret = target.secretId ? await input.secrets.resolve({ id: target.secretId }) : undefined;
    const env = await envRequirements(target.projectId, target);
    const status = await input.git.status(project.path);
    const report = await buildReadiness({
      projectRoot: project.path,
      target,
      adapter,
      framework,
      secret,
      env: env.map(({ name, required, resolved, source }) => ({ name, required, resolved, source })),
      git: { isRepository: status.isRepository, dirty: status.modified.length + status.untracked.length },
      lastValidation: input.lastValidation?.(target.projectId),
    });
    return { report, framework, env, adapter, secret, project };
  };

  /** Runs the project's build script for prebuilt adapters, streaming lines into the deployment log. */
  const buildProject =
    (
      projectRoot: string,
      env: Record<string, string>,
      signal: AbortSignal,
      emit: (e: DeployEvent) => void,
      outputDir: string,
    ) =>
    async () => {
      const pm = detectPackageManager(projectRoot);
      const exe = resolveExecutable(pm);
      if (!exe) {
        emit({ kind: "log", text: `${pm} is not installed` });
        return { ok: false, outputDir };
      }
      const result = await runCommand({
        file: exe.file,
        args: [...exe.args, "run", "build"],
        cwd: projectRoot,
        timeoutMs: PHASE_TIMEOUTS_MS.build,
        signal,
        env,
        onLine: (_stream, line) => {
          emit({ kind: "log", text: line });
        },
      });
      return { ok: result.exitCode === 0, outputDir };
    };

  const start = async (target: DeploymentTarget): Promise<string> => {
    for (const [, d] of live)
      if (!d.finished)
        throw new AppError(
          "conflict",
          "deploy.running",
          "A deployment is already running; wait for it to finish or cancel it.",
        );
    const { report, framework, env, adapter, secret, project } = await readiness(target);
    if (!report.ready) {
      const failing = report.items.filter((i) => i.status === "fail").map((i) => i.label);
      throw new AppError("precondition", "deploy.not_ready", `Not ready to deploy: ${failing.join(", ")}.`, {
        details: { items: failing },
      });
    }
    const id = newId("dep");
    const record: DeploymentRecord = {
      id,
      targetId: target.id,
      projectId: target.projectId,
      adapterId: target.adapterId,
      status: "running",
      startedAt: now(),
    };
    input.deployments.insert(record);
    const state: LiveDeployment = {
      events: [],
      listeners: new Set(),
      controller: new AbortController(),
      finished: false,
    };
    live.set(id, state);
    const emit = (event: DeployEvent) => {
      state.events.push(event);
      for (const l of state.listeners) l(event);
    };
    const envValues = Object.fromEntries(
      env.filter((e) => e.value !== undefined).map((e) => [e.name, e.value ?? ""]),
    );
    changed(target.projectId);
    void (async () => {
      let url: string | undefined;
      let providerRef: string | undefined;
      let error: string | undefined;
      try {
        for await (const event of adapter.deploy({
          projectRoot: project.path,
          target,
          framework,
          secret,
          env: envValues,
          signal: state.controller.signal,
          log: input.logger.child(`deploy:${id}`),
          build: buildProject(project.path, envValues, state.controller.signal, emit, framework.outputDir),
        })) {
          emit(event);
          if (event.kind === "done") {
            url = event.url;
            providerRef = event.providerRef;
          }
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        emit({ kind: "error", message: error });
      }
      const cancelled = state.controller.signal.aborted;
      const log = state.events
        .filter((e) => e.kind === "log")
        .map((e) => (e as { text: string }).text)
        .join("\n")
        .slice(-100_000);
      input.deployments.finish(id, {
        status: cancelled ? "cancelled" : error ? "failed" : "succeeded",
        url,
        providerRef,
        error,
        finishedAt: now(),
        log,
      });
      state.finished = true;
      for (const l of state.listeners) l(null);
      input.logger.info("deployment finished", {
        deploymentId: id,
        status: cancelled ? "cancelled" : error ? "failed" : "succeeded",
        adapter: adapter.id,
      });
      changed(target.projectId);
      setTimeout(() => live.delete(id), 10 * 60_000).unref();
    })();
    return id;
  };

  // ---- handlers
  input.bus.handle(contracts.deployAdapters, () =>
    adapters.map((a) => ({
      id: a.id,
      displayName: a.displayName,
      mode: a.mode,
      ...(a.secret ? { secret: a.secret } : {}),
      configFields: a.configFields.map((f) => ({
        key: f.key,
        label: f.label,
        required: f.required,
        ...(f.placeholder !== undefined ? { placeholder: f.placeholder } : {}),
      })),
      discoverable: a.discover !== undefined,
    })),
  );
  input.bus.handle(contracts.deployTargets, ({ projectId }) => {
    input.projects.get(projectId);
    return input.targets.list(projectId);
  });
  input.bus.handle(contracts.deployUpsertTarget, async (req) => {
    const project = input.projects.get(req.projectId);
    const existing = req.id ? input.targets.get(req.id) : undefined;
    if (req.id && existing?.projectId !== project.id)
      throw new AppError("not_found", "deploy.target_not_found", "Deployment target not found.");
    deploymentAdapter(adapters, req.adapterId);
    const secretId = req.secretId ?? existing?.secretId;
    if (req.secretId !== undefined && (await input.secrets.resolve({ id: req.secretId })) === undefined) {
      throw new AppError("not_found", "deploy.secret_missing", "The referenced secret does not exist.");
    }
    if (existing?.secretId && req.secretId && existing.secretId !== req.secretId)
      await input.secrets.delete(existing.secretId).catch(() => undefined);
    const target: DeploymentTarget = {
      id: existing?.id ?? newId("tgt"),
      projectId: project.id,
      adapterId: req.adapterId,
      name: req.name,
      config: req.config,
      envSecrets: existing?.envSecrets ?? {},
      updatedAt: now(),
    };
    if (secretId) target.secretId = secretId;
    input.targets.upsert(target);
    changed(project.id);
    return target;
  });
  input.bus.handle(contracts.deployDeleteTarget, async ({ id }) => {
    const target = input.targets.get(id);
    if (!target) return;
    if (target.secretId) await input.secrets.delete(target.secretId).catch(() => undefined);
    for (const secretId of Object.values(target.envSecrets))
      await input.secrets.delete(secretId).catch(() => undefined);
    input.targets.delete(id);
    changed(target.projectId);
  });
  input.bus.handle(contracts.deploySetEnv, async ({ targetId, name, secretId }) => {
    const target = targetOf(targetId);
    const previous = target.envSecrets[name];
    const envSecrets = Object.fromEntries(Object.entries(target.envSecrets).filter(([k]) => k !== name));
    if (secretId) {
      if ((await input.secrets.resolve({ id: secretId })) === undefined)
        throw new AppError("not_found", "deploy.secret_missing", "The referenced secret does not exist.");
      envSecrets[name] = secretId;
    }
    if (previous && previous !== secretId) await input.secrets.delete(previous).catch(() => undefined);
    const next: DeploymentTarget = { ...target, envSecrets, updatedAt: now() };
    input.targets.upsert(next);
    changed(target.projectId);
    return next;
  });
  input.bus.handle(contracts.deployDiscover, async ({ adapterId, secretId }, ctx) => {
    const adapter = deploymentAdapter(adapters, adapterId);
    if (!adapter.discover)
      throw new AppError(
        "validation",
        "deploy.not_discoverable",
        `${adapter.displayName} has no discovery API.`,
      );
    const token = await input.secrets.resolve({ id: secretId });
    if (token === undefined)
      throw new AppError("not_found", "deploy.secret_missing", "The access token secret does not exist.");
    const sites = await adapter.discover(token, ctx.signal);
    return sites.map((s) => ({
      id: s.id,
      name: s.name,
      ...(s.url !== undefined ? { url: s.url } : {}),
      config: s.config,
    }));
  });
  input.bus.handle(contracts.deployReadiness, async ({ targetId }) => {
    const { report, framework, env } = await readiness(targetOf(targetId));
    return {
      ...report,
      framework: framework.framework,
      env: env.map(({ name, required, resolved, source, description }) => ({
        name,
        required,
        resolved,
        ...(source !== undefined ? { source } : {}),
        ...(description !== undefined ? { description } : {}),
      })),
    };
  });
  input.bus.handle(contracts.deployRun, async ({ targetId }) => ({
    deploymentId: await start(targetOf(targetId)),
  }));
  input.bus.handle(contracts.deployCancel, ({ deploymentId }) => {
    live.get(deploymentId)?.controller.abort();
  });
  input.bus.handle(contracts.deployHistory, ({ projectId, limit }) => {
    input.projects.get(projectId);
    return input.deployments.list(projectId, limit);
  });
  input.bus.handleStream(contracts.deployEvents, ({ deploymentId }, ctx) =>
    eventStream(deploymentId, ctx.signal),
  );

  async function* eventStream(deploymentId: string, signal: AbortSignal): AsyncGenerator<DeployEvent> {
    const state = live.get(deploymentId);
    if (!state) {
      // Finished earlier (or after restart): replay what was persisted.
      const record = input.deployments.get(deploymentId);
      if (!record) throw new AppError("not_found", "deploy.not_found", "Deployment not found.");
      for (const line of record.log.split("\n").filter(Boolean)) yield { kind: "log", text: line };
      if (record.status === "succeeded")
        yield {
          kind: "done",
          ...(record.url !== undefined ? { url: record.url } : {}),
          ...(record.providerRef !== undefined ? { providerRef: record.providerRef } : {}),
        };
      else if (record.error !== undefined) yield { kind: "error", message: record.error };
      return;
    }
    let cursor = 0;
    const queue: (DeployEvent | null)[] = [];
    let wake: (() => void) | undefined;
    const listener = (event: DeployEvent | null) => {
      queue.push(event);
      wake?.();
    };
    state.listeners.add(listener);
    try {
      while (cursor < state.events.length) {
        const event = state.events[cursor];
        cursor += 1;
        if (event) yield event;
      }
      if (state.finished) return;
      for (;;) {
        if (signal.aborted) return;
        if (queue.length === 0)
          await new Promise<void>((resolve) => {
            wake = resolve;
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        wake = undefined;
        while (queue.length > 0) {
          const next = queue.shift();
          if (next === null || next === undefined) return;
          yield next;
        }
      }
    } finally {
      state.listeners.delete(listener);
    }
  }

  return {
    async close() {
      for (const [, d] of live) if (!d.finished) d.controller.abort();
      await Promise.resolve();
    },
  };
}
