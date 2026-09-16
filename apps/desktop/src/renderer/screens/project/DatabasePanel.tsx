import { useId, useMemo, useState } from "react";
import { integrations, project, settings as settingsContracts } from "@autoappz/contracts";
import { Banner, Button, Card, EmptyState, Field, Select, Tag, TextInput } from "@autoappz/ui";
import { useCommand, useQuery } from "../../state/hooks.ts";

type AdapterId = integrations.DatabaseAdapterId;

/** Integration hub for the project's database: configure Postgres/Supabase/Neon, test, attach, browse the schema. */
export function DatabasePanel({ projectId }: { readonly projectId: string }) {
  const input = useMemo(() => ({ projectId }), [projectId]);
  const adapters = useQuery(integrations.integrationsAdapters, undefined);
  const list = useQuery(integrations.integrationsList, input);
  const settings = useQuery(project.projectSettingsGet, input);
  const upsert = useCommand(integrations.integrationsUpsert);
  const remove = useCommand(integrations.integrationsDelete);
  const test = useCommand(integrations.integrationsTest);
  const discover = useCommand(integrations.integrationsDiscover);
  const updateSettings = useCommand(project.projectSettingsUpdate);
  const storeSecret = useCommand(settingsContracts.secretsSet);
  const ids = { adapter: useId(), name: useId(), secret: useId(), token: useId() };
  const [adapterId, setAdapterId] = useState<AdapterId>("postgres");
  const [name, setName] = useState("Database");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [discovered, setDiscovered] = useState<Awaited<ReturnType<typeof discover.run>>>();
  const [testResult, setTestResult] = useState<string | undefined>();
  const adapter = adapters.data?.find((a) => a.id === adapterId);
  const attachedId = settings.data?.databaseIntegrationId;
  const error =
    upsert.error ?? remove.error ?? test.error ?? discover.error ?? updateSettings.error ?? storeSecret.error;

  const save = async () => {
    const cleaned = Object.fromEntries(Object.entries(config).filter(([, v]) => v.trim().length > 0));
    const displayName = name.trim().length > 0 ? name.trim() : (adapter?.displayName ?? "Database");
    // The secret value only ever travels through secrets.set; the integration stores its reference.
    const ref = await storeSecret.run({
      kind: adapter?.secret.kind ?? "password",
      provider: `db:${adapterId}`,
      label: `${displayName} (${adapter?.displayName ?? adapterId})`,
      value: secret.trim(),
    });
    if (!ref) return;
    const created = await upsert.run({
      projectId,
      adapterId,
      name: displayName,
      config: cleaned,
      secretId: ref.id,
      attach: true,
    });
    if (created) {
      setSecret("");
      const result = await test.run({ id: created.id });
      if (result) setTestResult(result.message);
    }
  };

  return (
    <Card
      title="Database"
      description="Attach a PostgreSQL database (local, Supabase or Neon). AutoAPPZ injects DATABASE_URL into the project's processes and gives the agent schema-aware, permission-gated SQL tools. Destructive SQL is never run by the agent."
    >
      {error ? <Banner tone="danger">{error.message}</Banner> : null}
      {(list.data ?? []).length > 0 ? (
        <ul className="az-list" aria-label="Databases">
          {(list.data ?? []).map((i) => (
            <li key={i.id} className="az-list-row">
              <Tag>{i.status}</Tag>
              <span className="az-list-grow">
                <div>
                  <strong>{i.name}</strong> <span className="az-muted">{i.adapterId}</span>
                  {attachedId === i.id ? <Tag>attached</Tag> : null}
                </div>
                {i.statusMessage ? <div className="az-list-secondary">{i.statusMessage}</div> : null}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={test.pending}
                onClick={() =>
                  void test.run({ id: i.id }).then((r) => {
                    if (r) setTestResult(r.message);
                  })
                }
              >
                Test
              </Button>
              {attachedId !== i.id ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void updateSettings.run({ projectId, patch: { databaseIntegrationId: i.id } })
                  }
                >
                  Attach
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="danger"
                disabled={remove.pending}
                onClick={() => void remove.run({ id: i.id })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No database attached yet.</EmptyState>
      )}
      {testResult ? (
        <Banner tone={testResult.startsWith("Connected") ? "info" : "warning"}>{testResult}</Banner>
      ) : null}

      <h4>Add a database</h4>
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
      <Field label="Name" htmlFor={ids.name}>
        <TextInput
          id={ids.name}
          value={name}
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      {adapter?.discoverable ? (
        <Field
          label={`${adapter.displayName} access token`}
          htmlFor={ids.token}
          hint="Stored as a secret (Settings → Secrets) and used to list your projects."
        >
          <div className="az-row">
            <TextInput
              id={ids.token}
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={discover.pending || token.trim().length === 0}
              onClick={() =>
                void storeSecret
                  .run({
                    kind: "api-key",
                    provider: `db:${adapterId}`,
                    label: `${adapter.displayName} access token`,
                    value: token.trim(),
                  })
                  .then(async (ref) => {
                    if (!ref) return;
                    setDiscovered(await discover.run({ adapterId, secretId: ref.id }));
                    setToken("");
                  })
              }
            >
              List projects
            </Button>
          </div>
        </Field>
      ) : null}
      {discovered ? (
        <ul className="az-list" aria-label="Discovered projects">
          {discovered.map((d) => (
            <li key={d.id} className="az-list-row">
              <span className="az-list-grow">
                {d.name} {d.region ? <span className="az-muted">{d.region}</span> : null}
              </span>
              {d.branches && d.branches.length > 0 ? (
                d.branches.map((b) => (
                  <Button
                    key={b.id}
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setConfig(b.config);
                      setName(`${d.name} / ${b.name}`);
                    }}
                  >
                    Use {b.name}
                  </Button>
                ))
              ) : (
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
              )}
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
            onChange={(e) => {
              setConfig({ ...config, [f.key]: e.target.value });
            }}
          />
        </Field>
      ))}
      {adapter ? (
        <Field label={adapter.secret.label} htmlFor={ids.secret} hint={adapter.secret.hint}>
          <TextInput
            id={ids.secret}
            type="password"
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
            }}
          />
        </Field>
      ) : null}
      <div className="az-row">
        <Button
          size="sm"
          disabled={upsert.pending || test.pending || secret.trim().length === 0}
          onClick={() => void save()}
        >
          Save and test
        </Button>
      </div>
      {attachedId ? <SchemaView projectId={projectId} /> : null}
    </Card>
  );
}

function SchemaView({ projectId }: { readonly projectId: string }) {
  const schema = useQuery(
    integrations.dbIntrospect,
    useMemo(() => ({ projectId }), [projectId]),
  );
  if (schema.status === "error")
    return <p className="az-muted">Schema unavailable: {schema.error?.message}</p>;
  if (!schema.data) return null;
  return (
    <details className="az-details" data-testid="db-schema">
      <summary>
        Schema: {String(schema.data.tables.length)} table(s)
        {schema.data.serverVersion ? ` · ${schema.data.serverVersion}` : ""}
      </summary>
      <ul className="az-list" aria-label="Tables">
        {schema.data.tables.map((t) => (
          <li key={`${t.schema}.${t.name}`} className="az-list-row">
            <span className="az-list-grow">
              <div>
                <code>
                  {t.schema}.{t.name}
                </code>{" "}
                <span className="az-muted">~{String(t.estimatedRows)} rows</span>
              </div>
              <div className="az-list-secondary">
                {t.columns.map((c) => `${c.name} ${c.type}${c.primaryKey ? " [pk]" : ""}`).join(", ")}
              </div>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
