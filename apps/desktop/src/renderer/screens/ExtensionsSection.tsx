import { useId, useMemo, useState } from "react";
import { mcp, plugins, project, settings as settingsContracts } from "@autoappz/contracts";
import { Banner, Button, Card, Checkbox, EmptyState, Field, Select, Tag, TextInput } from "@autoappz/ui";
import { useCommand, useQuery } from "../state/hooks.ts";

/** Settings → Extensions: MCP servers (stdio / HTTP with bearer or OAuth) and in-process plugins. */
export function ExtensionsSection() {
  return (
    <>
      <McpServersCard />
      <PluginsCard />
    </>
  );
}

function McpServersCard() {
  const servers = useQuery(mcp.mcpServers, undefined);
  const upsert = useCommand(mcp.mcpUpsert);
  const remove = useCommand(mcp.mcpDelete);
  const connect = useCommand(mcp.mcpConnect);
  const disconnect = useCommand(mcp.mcpDisconnect);
  const storeSecret = useCommand(settingsContracts.secretsSet);
  const ids = {
    name: useId(),
    transport: useId(),
    command: useId(),
    args: useId(),
    url: useId(),
    auth: useId(),
    token: useId(),
  };
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<"none" | "bearer" | "oauth">("none");
  const [token, setToken] = useState("");
  const [selected, setSelected] = useState<string | undefined>();
  const tools = useQuery(
    mcp.mcpTools,
    useMemo(() => ({ id: selected ?? "-" }), [selected]),
  );
  const error = upsert.error ?? remove.error ?? connect.error ?? disconnect.error ?? storeSecret.error;

  const add = async () => {
    let tokenSecretId: string | undefined;
    if (transport === "http" && auth === "bearer") {
      if (!token.trim()) return;
      const ref = await storeSecret.run({
        kind: "api-key",
        provider: "mcp",
        label: `${name.trim()} (MCP bearer token)`,
        value: token.trim(),
      });
      if (!ref) return;
      tokenSecretId = ref.id;
    }
    const created = await upsert.run({
      name: name.trim(),
      transport,
      ...(transport === "stdio"
        ? { command: command.trim(), args: args.trim() ? args.trim().split(/\s+/) : [] }
        : { url: url.trim(), args: [] }),
      auth: transport === "http" ? auth : "none",
      envSecrets: {},
      enabled: true,
      ...(tokenSecretId ? { tokenSecretId } : {}),
    });
    if (created) {
      setName("");
      setCommand("");
      setArgs("");
      setUrl("");
      setToken("");
      setSelected(created.id);
    }
  };

  return (
    <Card
      title="MCP servers"
      description="Model Context Protocol servers extend the agent with external tools. Servers are added only here, run as argument arrays with an environment allowlist, and every tool call asks for consent (destructive tools never run automatically). Results are treated as untrusted data."
    >
      {error ? <Banner tone="danger">{error.message}</Banner> : null}
      {(servers.data ?? []).length > 0 ? (
        <ul className="az-list" aria-label="MCP servers">
          {(servers.data ?? []).map((s) => (
            <li key={s.id} className="az-list-row">
              <Tag>{s.status}</Tag>
              <button
                type="button"
                className="az-linklike az-list-grow"
                aria-current={selected === s.id ? "true" : undefined}
                onClick={() => setSelected(s.id)}
              >
                <strong>{s.name}</strong>{" "}
                <span className="az-muted">
                  {s.transport === "stdio" ? `${s.command ?? ""} ${s.args.join(" ")}` : s.url}
                </span>
                {s.statusMessage ? <div className="az-list-secondary">{s.statusMessage}</div> : null}
                {s.toolCount !== undefined ? (
                  <div className="az-list-secondary">{String(s.toolCount)} tool(s)</div>
                ) : null}
              </button>
              {s.status === "connected" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disconnect.pending}
                  onClick={() => void disconnect.run({ id: s.id })}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={connect.pending}
                  onClick={() => void connect.run({ id: s.id })}
                >
                  Connect
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                disabled={remove.pending}
                onClick={() => void remove.run({ id: s.id })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No MCP servers configured.</EmptyState>
      )}
      {selected && (tools.data ?? []).length > 0 ? (
        <ul className="az-list" aria-label="MCP tools">
          {(tools.data ?? []).map((t) => (
            <li key={t.id} className="az-list-row">
              <Tag>{t.risk}</Tag>
              <span className="az-list-grow">
                <code>{t.id}</code>
                <div className="az-list-secondary">{t.description}</div>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <h4>Add a server</h4>
      <Field label="Name" htmlFor={ids.name}>
        <TextInput id={ids.name} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Transport" htmlFor={ids.transport}>
        <Select
          id={ids.transport}
          value={transport}
          onChange={(e) => setTransport(e.target.value as "stdio" | "http")}
        >
          <option value="stdio">stdio (local command)</option>
          <option value="http">HTTP (Streamable HTTP)</option>
        </Select>
      </Field>
      {transport === "stdio" ? (
        <>
          <Field
            label="Command"
            htmlFor={ids.command}
            hint="Executable name or path; arguments are passed as a list, never through a shell."
          >
            <TextInput
              id={ids.command}
              value={command}
              placeholder="npx"
              onChange={(e) => setCommand(e.target.value)}
            />
          </Field>
          <Field label="Arguments" htmlFor={ids.args}>
            <TextInput
              id={ids.args}
              value={args}
              placeholder="-y @scope/some-mcp-server"
              onChange={(e) => setArgs(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="URL" htmlFor={ids.url}>
            <TextInput
              id={ids.url}
              value={url}
              placeholder="https://example.com/mcp"
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <Field label="Authentication" htmlFor={ids.auth}>
            <Select
              id={ids.auth}
              value={auth}
              onChange={(e) => setAuth(e.target.value as "none" | "bearer" | "oauth")}
            >
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="oauth">OAuth (sign in with your browser)</option>
            </Select>
          </Field>
          {auth === "bearer" ? (
            <Field label="Bearer token" htmlFor={ids.token} hint="Stored as a secret.">
              <TextInput
                id={ids.token}
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </Field>
          ) : null}
        </>
      )}
      <div className="az-row">
        <Button
          size="sm"
          disabled={
            upsert.pending ||
            storeSecret.pending ||
            !name.trim() ||
            (transport === "stdio" ? !command.trim() : !url.trim())
          }
          onClick={() => void add()}
        >
          Add server
        </Button>
      </div>
    </Card>
  );
}

function PluginsCard() {
  const list = useQuery(plugins.pluginsList, undefined);
  const install = useCommand(plugins.pluginsInstall);
  const setEnabled = useCommand(plugins.pluginsSetEnabled);
  const grant = useCommand(plugins.pluginsGrant);
  const remove = useCommand(plugins.pluginsRemove);
  const pick = useCommand(project.dialogPickDirectory);
  const [dir, setDir] = useState("");
  const ids = { dir: useId() };
  const error = install.error ?? setEnabled.error ?? grant.error ?? remove.error ?? pick.error;
  return (
    <Card
      title="Plugins"
      description="In-process plugins from a folder you choose. They see only the capabilities you grant (never the file system, processes or Electron); nothing runs until you enable a plugin."
    >
      {error ? <Banner tone="danger">{error.message}</Banner> : null}
      {(list.data ?? []).length > 0 ? (
        <ul className="az-list" aria-label="Plugins">
          {(list.data ?? []).map((p) => (
            <li key={p.id} className="az-list-row" data-testid={`plugin-${p.id}`}>
              <Tag>{p.status}</Tag>
              <span className="az-list-grow">
                <div>
                  <strong>{p.manifest.displayName}</strong>{" "}
                  <span className="az-muted">v{p.manifest.version}</span>
                </div>
                <div className="az-list-secondary">{p.manifest.description || p.dir}</div>
                {p.error ? <div className="az-list-secondary">{p.error}</div> : null}
                {p.tools.length > 0 ? (
                  <div className="az-list-secondary">tools: {p.tools.join(", ")}</div>
                ) : null}
                <div className="az-row">
                  {p.manifest.capabilities.map((c) => (
                    <Checkbox
                      key={c}
                      label={c}
                      checked={p.granted.includes(c)}
                      onChange={(e) =>
                        void grant.run({
                          id: p.id,
                          capabilities: e.target.checked
                            ? [...p.granted, c]
                            : p.granted.filter((g) => g !== c),
                        })
                      }
                    />
                  ))}
                </div>
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={setEnabled.pending}
                onClick={() => void setEnabled.run({ id: p.id, enabled: !p.enabled })}
              >
                {p.enabled ? "Disable" : "Enable"}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={remove.pending}
                onClick={() => void remove.run({ id: p.id })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No plugins installed.</EmptyState>
      )}
      <Field
        label="Plugin folder"
        htmlFor={ids.dir}
        hint="A folder containing plugin.json and its JavaScript entry."
      >
        <div className="az-row">
          <TextInput id={ids.dir} value={dir} onChange={(e) => setDir(e.target.value)} />
          <Button
            size="sm"
            variant="secondary"
            disabled={pick.pending}
            onClick={() =>
              void pick.run({ title: "Choose a plugin folder" }).then((r) => r?.path && setDir(r.path))
            }
          >
            Browse…
          </Button>
          <Button
            size="sm"
            disabled={install.pending || !dir.trim()}
            onClick={() => void install.run({ dir: dir.trim() }).then((r) => r && setDir(""))}
          >
            Install
          </Button>
        </div>
      </Field>
    </Card>
  );
}
