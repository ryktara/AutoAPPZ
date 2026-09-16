import { useId, useState } from "react";
import { settings, type SecretKind } from "@autoappz/contracts";
import {
  Banner,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Page,
  Select,
  Tag,
  TextInput,
} from "@autoappz/ui";
import { useCommand, useQuery } from "../state/hooks.ts";

const SECRET_KINDS: readonly { value: SecretKind; label: string }[] = [
  { value: "api-key", label: "API key" },
  { value: "oauth-token", label: "OAuth token" },
  { value: "password", label: "Password" },
  { value: "connection-string", label: "Connection string" },
  { value: "other", label: "Other" },
];

export function SettingsScreen() {
  return (
    <Page title="Settings" subtitle="Preferences are stored locally. Secrets live in your OS secure storage.">
      <GeneralSection />
      <SecretsSection />
    </Page>
  );
}

function GeneralSection() {
  const current = useQuery(settings.settingsGet, undefined);
  const update = useCommand(settings.settingsUpdate);
  const ids = { theme: useId(), telemetry: useId(), template: useId(), approve: useId(), motion: useId() };
  const s = current.data;
  if (!s)
    return (
      <Card title="General">
        {current.status === "error" ? (
          <Banner tone="danger">Could not load settings.</Banner>
        ) : (
          <p className="az-muted">Loading…</p>
        )}
      </Card>
    );

  return (
    <Card title="General">
      {update.error ? <Banner tone="danger">{update.error.message}</Banner> : null}
      <Field label="Theme" htmlFor={ids.theme}>
        <Select
          id={ids.theme}
          value={s.theme}
          onChange={(e) => void update.run({ theme: e.target.value as typeof s.theme })}
        >
          <option value="system">Follow system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </Select>
      </Field>
      <Field
        label="Usage telemetry"
        htmlFor={ids.telemetry}
        hint="Anonymous product analytics. Never includes code, prompts or secrets."
      >
        <Select
          id={ids.telemetry}
          value={s.telemetryConsent}
          onChange={(e) => void update.run({ telemetryConsent: e.target.value as typeof s.telemetryConsent })}
        >
          <option value="unset">Not decided</option>
          <option value="opted_in">Send anonymous usage data</option>
          <option value="opted_out">Do not send</option>
        </Select>
      </Field>
      <Field label="Default template" htmlFor={ids.template}>
        <TextInput
          id={ids.template}
          defaultValue={s.defaultTemplateId}
          onBlur={(e) => {
            if (e.target.value && e.target.value !== s.defaultTemplateId)
              void update.run({ defaultTemplateId: e.target.value });
          }}
        />
      </Field>
      <Field
        label="Auto-approve plans"
        htmlFor={ids.approve}
        hint="Plans at or below this complexity run without an approval step."
      >
        <Select
          id={ids.approve}
          value={s.autoApprovePlansBelowComplexity}
          onChange={(e) =>
            void update.run({
              autoApprovePlansBelowComplexity: e.target.value as typeof s.autoApprovePlansBelowComplexity,
            })
          }
        >
          <option value="none">Always ask</option>
          <option value="trivial">Trivial changes</option>
          <option value="standard">Trivial and standard changes</option>
        </Select>
      </Field>
      <Checkbox
        id={ids.motion}
        label="Reduce motion"
        checked={s.reducedMotion}
        onChange={(e) => void update.run({ reducedMotion: e.target.checked })}
      />
    </Card>
  );
}

function SecretsSection() {
  const list = useQuery(settings.secretsList, undefined);
  const status = useQuery(settings.secretsStorageStatus, undefined);
  const set = useCommand(settings.secretsSet);
  const remove = useCommand(settings.secretsDelete);
  const ids = { kind: useId(), label: useId(), value: useId() };
  const [kind, setKind] = useState<SecretKind>("api-key");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const unavailable = status.data ? !status.data.available : false;

  const onSubmit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    const ref = await set.run({ kind, label: label.trim(), value });
    if (ref) {
      setLabel("");
      setValue("");
    }
  };

  return (
    <Card
      title="Secrets"
      description="API keys and tokens are encrypted by the operating system and never shown again."
    >
      {status.data ? (
        unavailable ? (
          <Banner tone="warning">
            No secure storage is available on this machine (backend: {status.data.backend}). Secrets cannot be
            saved until a keyring is available.
          </Banner>
        ) : (
          <p className="az-muted">
            Secure storage: <Tag>{status.data.backend}</Tag>
          </p>
        )
      ) : null}

      {list.data && list.data.length > 0 ? (
        <ul className="az-list" aria-label="Stored secrets">
          {list.data.map((ref) => (
            <li key={ref.id} className="az-list-row">
              <div className="az-list-grow">
                <div className="az-list-primary">{ref.label}</div>
                <div className="az-list-secondary">
                  {ref.kind}
                  {ref.provider ? ` · ${ref.provider}` : ""}
                  {ref.lastFour ? ` · ····${ref.lastFour}` : ""} · added{" "}
                  {new Date(ref.createdAt).toLocaleDateString()}
                </div>
              </div>
              <Button
                variant="danger"
                size="sm"
                disabled={remove.pending}
                onClick={() => void remove.run({ id: ref.id })}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      ) : list.data ? (
        <EmptyState>No secrets stored yet.</EmptyState>
      ) : null}
      {remove.error ? <Banner tone="danger">{remove.error.message}</Banner> : null}

      <form
        onSubmit={(e) => void onSubmit(e)}
        aria-label="Add secret"
        className="az-card"
        style={{ padding: "var(--space-4)" }}
      >
        <h3 className="az-card-title">Add a secret</h3>
        {set.error ? <Banner tone="danger">{set.error.message}</Banner> : null}
        <Field label="Kind" htmlFor={ids.kind}>
          <Select
            id={ids.kind}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as SecretKind);
            }}
          >
            {SECRET_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Label"
          htmlFor={ids.label}
          hint="How this secret is shown in the app, e.g. “OpenAI (personal)”."
        >
          <TextInput
            id={ids.label}
            value={label}
            maxLength={120}
            onChange={(e) => {
              setLabel(e.target.value);
            }}
            required
          />
        </Field>
        <Field
          label="Value"
          htmlFor={ids.value}
          hint="Pasted once, encrypted immediately, never displayed again."
        >
          <TextInput
            id={ids.value}
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
            }}
            required
          />
        </Field>
        <div className="az-row">
          <Button
            type="submit"
            variant="primary"
            disabled={set.pending || unavailable || !label.trim() || !value}
          >
            {set.pending ? "Saving…" : "Save secret"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
