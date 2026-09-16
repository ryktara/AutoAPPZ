import { useEffect, useId, useMemo, useState } from "react";
import { deployment, settings as settingsContracts } from "@autoappz/contracts";
import { Banner, Button, Card, EmptyState, Field, Select, Tag, TextInput } from "@autoappz/ui";
import { useCommand, useQuery, useRuntime } from "../../state/hooks.ts";

type AdapterId = deployment.DeploymentAdapterId;

/** Deployment hub: targets (Vercel, Netlify, Cloudflare Pages, Docker), env sync, readiness, deploy with live log, history. */
export function DeployPanel({ projectId }: { readonly projectId: string }) {
  const input = useMemo(() => ({ projectId }), [projectId]);
  const adapters = useQuery(deployment.deployAdapters, undefined);
  const targets = useQuery(deployment.deployTargets, input);
  const history = useQuery(
    deployment.deployHistory,
    useMemo(() => ({ projectId, limit: 10 }), [projectId]),
  );
  const upsert = useCommand(deployment.deployUpsertTarget);
  const remove = useCommand(deployment.deployDeleteTarget);
  const discover = useCommand(deployment.deployDiscover);
  const storeSecret = useCommand(settingsContracts.secretsSet);
  const ids = { adapter: useId(), name: useId(), token: useId() };
  const [adapterId, setAdapterId] = useState<AdapterId>("docker");
  const [name, setName] = useState("Production");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [token, setToken] = useState("");
  const [discovered, setDiscovered] = useState<Awaited<ReturnType<typeof discover.run>>>();
  const [selected, setSelected] = useState<string | undefined>();
  const adapter = adapters.data?.find((a) => a.id === adapterId);
  const error = upsert.error ?? remove.error ?? discover.error ?? storeSecret.error;
  const activeTarget = (targets.data ?? []).find((t) => t.id === selected) ?? targets.data?.[0];

  const save = async () => {
    const cleaned = Object.fromEntries(Object.entries(config).filter(([, v]) => v.trim().length > 0));
    let secretId: string | undefined;
    if (adapter?.secret) {
      if (token.trim().length === 0) return;
      const ref = await storeSecret.run({
        kind: "api-key",
        provider: `deploy:${adapterId}`,
        label: `${name.trim() || adapter.displayName} (${adapter.displayName})`,
        value: token.trim(),
      });
      if (!ref) return;
      secretId = ref.id;
    }
    const created = await upsert.run({
      projectId,
      adapterId,
      name: name.trim() || (adapter?.displayName ?? "Target"),
      config: cleaned,
      ...(secretId ? { secretId } : {}),
    });
    if (created) {
      setToken("");
      setSelected(created.id);
    }
  };

  return (
    <Card
      title="Deploy"
      description="Deploy to Vercel, Netlify, Cloudflare Pages or build a Docker image. The readiness checklist has to pass first; environment values are stored as secrets and synced to the provider."
    >
      {error ? <Banner tone="danger">{error.message}</Banner> : null}
      {(targets.data ?? []).length > 0 ? (
        <ul className="az-list" aria-label="Deployment targets">
          {(targets.data ?? []).map((t) => (
            <li key={t.id} className="az-list-row">
              <Tag>{t.adapterId}</Tag>
              <button
                type="button"
                className="az-linklike az-list-grow"
                aria-current={activeTarget?.id === t.id ? "true" : undefined}
                onClick={() => setSelected(t.id)}
              >
                {t.name}
              </button>
              <Button
                size="sm"
                variant="danger"
                disabled={remove.pending}
                onClick={() => void remove.run({ id: t.id })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No deployment target yet.</EmptyState>
      )}
      {activeTarget ? <TargetView target={activeTarget} /> : null}

      <h4>Add a target</h4>
      <Field label="Provider" htmlFor={ids.adapter}>
        <Select
          id={ids.adapter}
          value={adapterId}
          onChange={(e) => {
            setAdapterId(e.target.value as AdapterId);
            setConfig({});
            setDiscovered(undefined);
          }}
        >
          {(adapters.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Target name" htmlFor={ids.name}>
        <TextInput id={ids.name} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      {adapter?.secret ? (
        <Field
          label={adapter.secret.label}
          htmlFor={ids.token}
          hint={`${adapter.secret.hint}. Stored as a secret.`}
        >
          <div className="az-row">
            <TextInput
              id={ids.token}
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            {adapter.discoverable ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={discover.pending || token.trim().length === 0}
                onClick={() =>
                  void storeSecret
                    .run({
                      kind: "api-key",
                      provider: `deploy:${adapterId}`,
                      label: `${adapter.displayName} token (discovery)`,
                      value: token.trim(),
                    })
                    .then(async (ref) => {
                      if (ref) setDiscovered(await discover.run({ adapterId, secretId: ref.id }));
                    })
                }
              >
                List sites
              </Button>
            ) : null}
          </div>
        </Field>
      ) : null}
      {discovered ? (
        <ul className="az-list" aria-label="Discovered sites">
          {discovered.map((d) => (
            <li key={d.id} className="az-list-row">
              <span className="az-list-grow">
                {d.name} {d.url ? <span className="az-muted">{d.url}</span> : null}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setConfig(d.config);
                  setName(d.name);
                }}
              >
                Use
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {(adapter?.configFields ?? []).map((f) => (
        <Field key={f.key} label={f.label} htmlFor={`${ids.name}-${f.key}`}>
          <TextInput
            id={`${ids.name}-${f.key}`}
            value={config[f.key] ?? ""}
            placeholder={f.placeholder}
            onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
          />
        </Field>
      ))}
      <div className="az-row">
        <Button
          size="sm"
          disabled={
            upsert.pending ||
            storeSecret.pending ||
            (adapter?.secret !== undefined && token.trim().length === 0)
          }
          onClick={() => void save()}
        >
          Add target
        </Button>
      </div>

      {(history.data ?? []).length > 0 ? (
        <>
          <h4>History</h4>
          <ul className="az-list" aria-label="Deployment history">
            {(history.data ?? []).map((d) => (
              <li key={d.id} className="az-list-row">
                <Tag>{d.status}</Tag>
                <span className="az-list-grow">
                  <div>
                    {d.adapterId} · {new Date(d.startedAt).toLocaleString()}
                  </div>
                  <div className="az-list-secondary">{d.url ?? d.providerRef ?? d.error ?? ""}</div>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

function TargetView({ target }: { readonly target: deployment.DeploymentTarget }) {
  const readiness = useQuery(
    deployment.deployReadiness,
    useMemo(() => ({ targetId: target.id }), [target.id]),
  );
  const run = useCommand(deployment.deployRun);
  const cancel = useCommand(deployment.deployCancel);
  const setEnv = useCommand(deployment.deploySetEnv);
  const storeSecret = useCommand(settingsContracts.secretsSet);
  const [deploymentId, setDeploymentId] = useState<string | undefined>();
  const [envDraft, setEnvDraft] = useState<Record<string, string>>({});
  const error = run.error ?? cancel.error ?? setEnv.error ?? storeSecret.error;
  const report = readiness.data;

  const saveEnv = async (name: string) => {
    const value = (envDraft[name] ?? "").trim();
    if (!value) return;
    const ref = await storeSecret.run({
      kind: "other",
      provider: "deploy:env",
      label: `${target.name} · ${name}`,
      value,
    });
    if (!ref) return;
    await setEnv.run({ targetId: target.id, name, secretId: ref.id });
    setEnvDraft({ ...envDraft, [name]: "" });
    readiness.refetch();
  };

  return (
    <section className="az-stack" aria-label={`Target ${target.name}`} data-testid="deploy-target">
      {error ? <Banner tone="danger">{error.message}</Banner> : null}
      {readiness.status === "error" ? <Banner tone="danger">{readiness.error?.message}</Banner> : null}
      {report ? (
        <>
          <div className="az-row">
            <strong>{target.name}</strong>
            <Tag>{report.ready ? "ready" : "not ready"}</Tag>
            <span className="az-muted">framework: {report.framework}</span>
            <Button size="sm" variant="secondary" onClick={() => readiness.refetch()}>
              Re-check
            </Button>
            <Button
              size="sm"
              disabled={!report.ready || run.pending}
              onClick={() =>
                void run.run({ targetId: target.id }).then((r) => setDeploymentId(r?.deploymentId))
              }
            >
              Deploy
            </Button>
          </div>
          <ul className="az-list" aria-label="Readiness checklist">
            {report.items.map((i) => (
              <li key={i.id} className="az-list-row">
                <Tag>{i.status}</Tag>
                <span className="az-list-grow">
                  <div>{i.label}</div>
                  <div className="az-list-secondary">
                    {i.detail}
                    {i.fix ? ` — ${i.fix}` : ""}
                  </div>
                </span>
              </li>
            ))}
          </ul>
          {report.env.length > 0 ? (
            <ul className="az-list" aria-label="Environment variables">
              {report.env.map((e) => (
                <li key={e.name} className="az-list-row">
                  <Tag>{e.resolved ? (e.source ?? "set") : e.required ? "missing" : "optional"}</Tag>
                  <span className="az-list-grow">
                    <div>
                      <code>{e.name}</code>
                    </div>
                    {e.description ? <div className="az-list-secondary">{e.description}</div> : null}
                  </span>
                  {e.source !== "attached database" ? (
                    <>
                      <TextInput
                        type="password"
                        aria-label={`Value for ${e.name}`}
                        value={envDraft[e.name] ?? ""}
                        onChange={(ev) => setEnvDraft({ ...envDraft, [e.name]: ev.target.value })}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={setEnv.pending}
                        onClick={() => void saveEnv(e.name)}
                      >
                        Set
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {deploymentId ? (
        <DeploymentLog deploymentId={deploymentId} onCancel={() => void cancel.run({ deploymentId })} />
      ) : null}
    </section>
  );
}

function DeploymentLog({
  deploymentId,
  onCancel,
}: {
  readonly deploymentId: string;
  readonly onCancel: () => void;
}) {
  const { client, cache } = useRuntime();
  const [events, setEvents] = useState<deployment.DeployEvent[]>([]);
  const [done, setDone] = useState(false);
  useEffect(() => {
    setEvents([]);
    setDone(false);
    const handle = client.stream(
      deployment.deployEvents,
      { deploymentId },
      {
        onChunk: (e) => setEvents((list) => [...list, e]),
        onEnd: () => {
          setDone(true);
          cache.invalidate(["deploy"]);
        },
        onError: (err) => {
          setEvents((list) => [...list, { kind: "error", message: err.message }]);
          setDone(true);
        },
      },
    );
    return () => handle.cancel();
  }, [client, cache, deploymentId]);
  const final = events.find((e) => e.kind === "done");
  return (
    <div className="az-stack" data-testid="deployment-log">
      <div className="az-row">
        <strong>Deployment</strong>
        <Tag>{done ? (final ? "succeeded" : "finished") : "running"}</Tag>
        {!done ? (
          <Button size="sm" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {final?.kind === "done" && final.url ? <code>{final.url}</code> : null}
        {final?.kind === "done" && final.hint ? <code>{final.hint}</code> : null}
      </div>
      <pre className="az-diff" aria-label="Deployment log">
        {events
          .map((e) =>
            e.kind === "step"
              ? `▸ ${e.name}: ${e.status}${e.detail ? ` (${e.detail})` : ""}`
              : e.kind === "log"
                ? `  ${e.text}`
                : e.kind === "error"
                  ? `✖ ${e.message}`
                  : `✔ done${e.url ? ` ${e.url}` : ""}`,
          )
          .join("\n")}
      </pre>
    </div>
  );
}
