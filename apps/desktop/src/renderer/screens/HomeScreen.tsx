import { useId, useState } from "react";
import { project } from "@autoappz/contracts";
import { Banner, Button, Card, EmptyState, Field, Page, Select, Tag, TextInput } from "@autoappz/ui";
import { useCommand, useQuery } from "../state/hooks.ts";
import { useRouter } from "../state/router.ts";

const LIST_INPUT = { includeArchived: false } as const;

export function HomeScreen() {
  return (
    <Page title="Projects" subtitle="Create a new app from a template or bring an existing folder.">
      <ProjectList />
      <div className="az-two-col">
        <CreateProjectForm />
        <ImportProjectForm />
      </div>
    </Page>
  );
}

function ProjectList() {
  const list = useQuery(project.projectList, LIST_INPUT);
  const open = useCommand(project.projectOpen);
  const { navigate } = useRouter();

  if (list.status === "error")
    return <Banner tone="danger">{list.error?.message ?? "Could not load projects."}</Banner>;
  if (!list.data) return <p className="az-muted">Loading projects…</p>;
  if (list.data.length === 0) {
    return <EmptyState>No projects yet. Create one below or import an existing folder.</EmptyState>;
  }
  return (
    <ul className="az-list" aria-label="Projects">
      {list.data.map((p) => (
        <li key={p.id} className="az-list-row">
          <div className="az-list-grow">
            <div className="az-list-primary">{p.name}</div>
            <div className="az-list-secondary">
              <code>{p.path}</code>
            </div>
          </div>
          <Tag>{p.origin}</Tag>
          {p.templateId ? <Tag>{p.templateId}</Tag> : null}
          <Button
            variant="primary"
            size="sm"
            disabled={open.pending}
            onClick={() => {
              void open.run({ id: p.id }).then((opened) => {
                if (opened) navigate({ name: "project", id: opened.id });
              });
            }}
          >
            Open
          </Button>
        </li>
      ))}
    </ul>
  );
}

function CreateProjectForm() {
  const templates = useQuery(project.projectTemplates, undefined);
  const defaultDir = useQuery(project.projectDefaultDirectory, undefined);
  const create = useCommand(project.projectCreate);
  const pick = useCommand(project.dialogPickDirectory);
  const { navigate } = useRouter();
  const ids = { name: useId(), template: useId(), dir: useId() };
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("react-vite");
  const [parentDirectory, setParentDirectory] = useState<string | undefined>();
  const effectiveDir = parentDirectory ?? defaultDir.data?.path ?? "";

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    const created = await create.run({
      name: name.trim(),
      templateId,
      ...(parentDirectory !== undefined ? { parentDirectory } : {}),
    });
    if (created) {
      setName("");
      navigate({ name: "project", id: created.id });
    }
  };

  return (
    <Card
      title="New project"
      description="Files are generated from the template. Nothing is installed until you start the runtime."
    >
      <form onSubmit={(e) => void submit(e)} aria-label="New project" className="az-stack">
        {create.error ? <Banner tone="danger">{create.error.message}</Banner> : null}
        <Field label="Name" htmlFor={ids.name}>
          <TextInput
            id={ids.name}
            value={name}
            maxLength={80}
            required
            placeholder="My app"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </Field>
        <Field label="Template" htmlFor={ids.template}>
          <Select
            id={ids.template}
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
            }}
          >
            {(templates.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName} — {t.description}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Location"
          htmlFor={ids.dir}
          hint="A folder named after the project is created inside this location."
        >
          <div className="az-row">
            <TextInput id={ids.dir} value={effectiveDir} readOnly aria-readonly="true" />
            <Button
              size="sm"
              disabled={pick.pending}
              onClick={() => {
                void pick
                  .run({ title: "Choose where to create the project", defaultPath: effectiveDir })
                  .then((r) => {
                    if (r?.path) setParentDirectory(r.path);
                  });
              }}
            >
              Choose…
            </Button>
          </div>
        </Field>
        <div className="az-row">
          <Button type="submit" variant="primary" disabled={create.pending || !name.trim() || !templateId}>
            {create.pending ? "Creating…" : "Create project"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ImportProjectForm() {
  const importCmd = useCommand(project.projectImport);
  const pick = useCommand(project.dialogPickDirectory);
  const { navigate } = useRouter();
  const ids = { path: useId(), mode: useId(), name: useId() };
  const [sourcePath, setSourcePath] = useState("");
  const [mode, setMode] = useState<"in_place" | "copy">("in_place");
  const [name, setName] = useState("");

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    const imported = await importCmd.run({
      sourcePath: sourcePath.trim(),
      mode,
      ...(name.trim() ? { name: name.trim() } : {}),
    });
    if (imported) navigate({ name: "project", id: imported.id });
  };

  return (
    <Card
      title="Import existing folder"
      description="Nothing runs on import. Dependencies install only when you start the runtime."
    >
      <form onSubmit={(e) => void submit(e)} aria-label="Import project" className="az-stack">
        {importCmd.error ? <Banner tone="danger">{importCmd.error.message}</Banner> : null}
        <Field label="Folder" htmlFor={ids.path}>
          <div className="az-row">
            <TextInput
              id={ids.path}
              value={sourcePath}
              placeholder="/path/to/existing-app"
              required
              onChange={(e) => {
                setSourcePath(e.target.value);
              }}
            />
            <Button
              size="sm"
              disabled={pick.pending}
              onClick={() => {
                void pick.run({ title: "Choose the folder to import" }).then((r) => {
                  if (r?.path) setSourcePath(r.path);
                });
              }}
            >
              Choose…
            </Button>
          </div>
        </Field>
        <Field
          label="Mode"
          htmlFor={ids.mode}
          hint="In place keeps working in the folder as-is. Copy duplicates it into your projects directory."
        >
          <Select
            id={ids.mode}
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as "in_place" | "copy");
            }}
          >
            <option value="in_place">Use in place</option>
            <option value="copy">Copy into projects directory</option>
          </Select>
        </Field>
        <Field label="Name" htmlFor={ids.name} hint="Optional; defaults to the folder name.">
          <TextInput
            id={ids.name}
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </Field>
        <div className="az-row">
          <Button type="submit" variant="primary" disabled={importCmd.pending || !sourcePath.trim()}>
            {importCmd.pending ? "Importing…" : "Import"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
