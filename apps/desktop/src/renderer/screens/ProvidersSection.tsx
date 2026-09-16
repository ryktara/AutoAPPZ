import { useId, useMemo, useState } from "react";
import { providers, settings as settingsContracts } from "@autoappz/contracts";
import { Banner, Button, Card, Checkbox, Field, Select, Tag, TextInput } from "@autoappz/ui";
import { useCommand, useQuery } from "../state/hooks.ts";

type ProviderStatus = providers.ProviderStatus;

const INTENTS: readonly { id: providers.RoutingIntent; label: string }[] = [
  { id: "planning", label: "Planning" },
  { id: "coding", label: "Coding" },
  { id: "fastEdit", label: "Fast edits" },
  { id: "review", label: "Review" },
  { id: "debug", label: "Debugging" },
  { id: "summarize", label: "Summaries" },
  { id: "classify", label: "Classification" },
];

/** Provider cards are equal: no vendor is featured, local inference is first-class. */
export function ProvidersSection() {
  const list = useQuery(providers.providersList, undefined);
  if (list.status === "error")
    return <Banner tone="danger">{list.error?.message ?? "Could not load providers."}</Banner>;
  if (!list.data) return <p className="az-muted">Loading providers…</p>;
  return (
    <>
      <Card
        title="Model providers"
        description="Bring your own keys or run local models. Keys are stored in your OS secure storage and validated against the provider."
      >
        <div className="az-provider-grid" data-testid="providers">
          {list.data.map((p) => (
            <ProviderCard key={p.providerId} status={p} />
          ))}
        </div>
      </Card>
      <RoutingCard />
      <UsageCard />
    </>
  );
}

function ProviderCard({ status }: { readonly status: ProviderStatus }) {
  const configure = useCommand(providers.providersConfigure);
  const validate = useCommand(providers.providersValidate);
  const setSecret = useCommand(settingsContracts.secretsSet);
  const ids = { enabled: useId(), key: useId(), url: useId(), model: useId() };
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(status.config.baseUrl ?? status.defaultBaseUrl ?? "");
  const modelsInput = useMemo(
    () => ({ providerId: status.providerId, onlyReady: false }),
    [status.providerId],
  );
  const models = useQuery(providers.providersModels, modelsInput);
  const error = configure.error ?? validate.error ?? setSecret.error;
  const busy = configure.pending || validate.pending || setSecret.pending;

  const saveKey = async () => {
    const ref = await setSecret.run({
      kind: "api-key",
      provider: status.providerId,
      label: `${status.displayName} API key`,
      value: key,
      ...(status.config.credentialId ? { replaceId: status.config.credentialId } : {}),
    });
    if (ref) {
      setKey("");
      await configure.run({ providerId: status.providerId, credentialId: ref.id, enabled: true });
    }
  };

  const saveBaseUrl = async () => {
    const trimmed = baseUrl.trim();
    if (trimmed === (status.config.baseUrl ?? "")) return;
    await configure.run({ providerId: status.providerId, baseUrl: trimmed ? trimmed : null });
  };

  return (
    <section
      className="az-provider"
      aria-label={status.displayName}
      data-testid={`provider-${status.providerId}`}
    >
      <header className="az-row" style={{ justifyContent: "space-between" }}>
        <h3 className="az-card-title">{status.displayName}</h3>
        <Tag>{status.ready ? "ready" : status.config.enabled ? "needs key" : "off"}</Tag>
      </header>
      {error ? <Banner tone="danger">{error.message}</Banner> : null}
      <Checkbox
        id={ids.enabled}
        label="Enabled"
        checked={status.config.enabled}
        disabled={busy}
        onChange={(e) => void configure.run({ providerId: status.providerId, enabled: e.target.checked })}
      />
      {status.requiresApiKey || status.providerId === "openai-compatible" ? (
        <Field
          label={status.config.credentialId ? "Replace API key" : "API key"}
          htmlFor={ids.key}
          hint={
            status.config.credentialId
              ? "A key is stored. Paste a new one to rotate it."
              : `Create one at ${status.docsUrl}`
          }
        >
          <div className="az-row">
            <TextInput
              id={ids.key}
              type="password"
              autoComplete="off"
              value={key}
              disabled={busy}
              onChange={(e) => {
                setKey(e.target.value);
              }}
            />
            <Button size="sm" variant="primary" disabled={busy || !key.trim()} onClick={() => void saveKey()}>
              Save key
            </Button>
          </div>
        </Field>
      ) : null}
      {status.supportsBaseUrl ? (
        <Field label="Base URL" htmlFor={ids.url}>
          <TextInput
            id={ids.url}
            value={baseUrl}
            disabled={busy}
            onChange={(e) => {
              setBaseUrl(e.target.value);
            }}
            onBlur={() => void saveBaseUrl()}
          />
        </Field>
      ) : null}
      {models.data && models.data.length > 0 ? (
        <Field label="Default model" htmlFor={ids.model}>
          <Select
            id={ids.model}
            value={status.config.defaultModelId ?? ""}
            disabled={busy}
            onChange={(e) =>
              void configure.run({
                providerId: status.providerId,
                defaultModelId: e.target.value ? e.target.value : null,
              })
            }
          >
            <option value="">Let the router choose</option>
            {models.data.map((m) => (
              <option key={m.modelId} value={m.modelId}>
                {m.displayName}
                {m.source === "discovered" ? " (discovered)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div className="az-row">
        <Button
          size="sm"
          disabled={busy || !status.config.enabled}
          onClick={() => void validate.run({ providerId: status.providerId })}
        >
          {validate.pending ? "Checking…" : "Validate"}
        </Button>
        {status.lastValidation ? (
          <span className={status.lastValidation.ok ? "az-ok" : "az-danger"} data-testid="validation-result">
            {status.lastValidation.message}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function RoutingCard() {
  const s = useQuery(providers.providersSettingsGet, undefined);
  const models = useQuery(
    providers.providersModels,
    useMemo(() => ({ onlyReady: true }), []),
  );
  const update = useCommand(providers.providersSettingsUpdate);
  const preview = useQuery(
    providers.providersRoute,
    useMemo(() => ({ intent: "coding" as const, complexity: "standard" as const }), []),
  );
  const ids = { privacy: useId(), cost: useId(), global: useId() };
  if (!s.data) return null;
  const options = models.data ?? [];
  const refValue = (r: providers.ModelRef | undefined) => (r ? `${r.providerId}::${r.modelId}` : "");
  const parseRef = (v: string): providers.ModelRef | null => {
    const [providerId, modelId] = v.split("::");
    return providerId && modelId ? { providerId: providerId as providers.ProviderId, modelId } : null;
  };
  return (
    <Card
      title="Routing"
      description="The router picks a model per task role and complexity. Your explicit choices always win."
    >
      {update.error ? <Banner tone="danger">{update.error.message}</Banner> : null}
      <Field
        label="Privacy"
        htmlFor={ids.privacy}
        hint="Local-only routes every call to models running on this machine."
      >
        <Select
          id={ids.privacy}
          value={s.data.policy.privacy}
          onChange={(e) => void update.run({ policy: { privacy: e.target.value as "any" | "local-only" } })}
        >
          <option value="any">Any configured provider</option>
          <option value="local-only">Local models only</option>
        </Select>
      </Field>
      <Field label="Cost sensitivity" htmlFor={ids.cost}>
        <Select
          id={ids.cost}
          value={String(s.data.policy.costWeight)}
          onChange={(e) => void update.run({ policy: { costWeight: Number(e.target.value) } })}
        >
          <option value="0">Ignore cost</option>
          <option value="0.5">Balanced</option>
          <option value="1">Prefer cheapest</option>
        </Select>
      </Field>
      <Field label="Use one model for everything" htmlFor={ids.global}>
        <Select
          id={ids.global}
          value={refValue(s.data.globalOverride)}
          onChange={(e) => void update.run({ globalOverride: parseRef(e.target.value) })}
        >
          <option value="">Off — route per role</option>
          {options.map((m) => (
            <option key={`${m.providerId}::${m.modelId}`} value={`${m.providerId}::${m.modelId}`}>
              {m.displayName} ({m.providerId})
            </option>
          ))}
        </Select>
      </Field>
      <details>
        <summary className="az-muted">Per-role overrides</summary>
        <div className="az-stack" style={{ marginTop: "var(--space-3)" }}>
          {INTENTS.map((intent) => (
            <Field key={intent.id} label={intent.label} htmlFor={`route-${intent.id}`}>
              <Select
                id={`route-${intent.id}`}
                value={refValue(s.data?.overrides[intent.id])}
                onChange={(e) => void update.run({ overrides: { [intent.id]: parseRef(e.target.value) } })}
              >
                <option value="">Automatic</option>
                {options.map((m) => (
                  <option key={`${m.providerId}::${m.modelId}`} value={`${m.providerId}::${m.modelId}`}>
                    {m.displayName} ({m.providerId})
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </div>
      </details>
      <p className="az-muted" data-testid="route-preview">
        {preview.data
          ? `Coding tasks would use ${preview.data.model.displayName} — ${preview.data.reason}`
          : "No ready provider yet; enable one above."}
      </p>
    </Card>
  );
}

function UsageCard() {
  const usage = useQuery(
    providers.usageSummary,
    useMemo(() => ({}), []),
  );
  if (!usage.data) return null;
  return (
    <Card title="Usage" description="Every model call is recorded with tokens and an estimated cost.">
      <dl className="az-dl">
        <dt>Calls</dt>
        <dd>{usage.data.calls}</dd>
        <dt>Input tokens</dt>
        <dd>{usage.data.inputTokens.toLocaleString()}</dd>
        <dt>Output tokens</dt>
        <dd>{usage.data.outputTokens.toLocaleString()}</dd>
        <dt>Estimated cost</dt>
        <dd>{usage.data.estimatedCostUsd === 0 ? "$0.00" : `$${usage.data.estimatedCostUsd.toFixed(4)}`}</dd>
      </dl>
    </Card>
  );
}
