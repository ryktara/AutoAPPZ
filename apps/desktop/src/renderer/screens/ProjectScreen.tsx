import { useEffect, useId, useMemo, useState } from "react";
import { RequestPane } from "./project/RequestPane.tsx";
import { TranscriptPanel } from "./project/TranscriptPanel.tsx";
import { PermissionsPanel } from "./project/PermissionsPanel.tsx";
import { PlanPanel } from "./project/PlanPanel.tsx";
import { ExecutionPanel } from "./project/ExecutionPanel.tsx";
import { ChangesPanel } from "./project/ChangesPanel.tsx";
import { GitPanel } from "./project/GitPanel.tsx";
import { PreviewPane } from "./project/PreviewPane.tsx";
import { Dock } from "./project/Dock.tsx";
import { useTaskStream } from "../state/use-task-stream.ts";
import { blueprint, memory, project, tasks } from "@autoappz/contracts";

type MemoryCategory = memory.MemoryCategory;
import {
  Banner,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Select,
  Tabs,
  Tag,
  TextArea,
  TextInput,
} from "@autoappz/ui";
import { useCommand, useQuery } from "../state/hooks.ts";
import { useRouter } from "../state/router.ts";

const WORK_TABS = [
  { id: "transcript", label: "Transcript" },
  { id: "plan", label: "Plan" },
  { id: "execution", label: "Execution" },
  { id: "changes", label: "Changes" },
  { id: "validation", label: "Validation" },
  { id: "blueprint", label: "Blueprint" },
  { id: "memory", label: "Memory" },
  { id: "project", label: "Project" },
] as const;
type WorkTab = (typeof WORK_TABS)[number]["id"];

export function ProjectScreen({ id }: { readonly id: string }) {
  const input = useMemo(() => ({ id }), [id]);
  const p = useQuery(project.projectGet, input);
  const [tab, setTab] = useState<WorkTab>("transcript");
  const [activeTaskId, setActiveTaskId] = useState<string | undefined>();
  const live = useTaskStream(activeTaskId);
  const recent = useQuery(
    tasks.taskList,
    useMemo(() => ({ projectId: id, limit: 1 }), [id]),
  );
  const latestTaskId = recent.data?.[0]?.id;
  useEffect(() => {
    if (activeTaskId === undefined && latestTaskId !== undefined) setActiveTaskId(latestTaskId);
  }, [activeTaskId, latestTaskId]);
  // While a build task is live, follow it into the Plan tab when it needs approval.
  useEffect(() => {
    if (live.state === "AWAIT_APPROVAL") setTab("plan");
  }, [live.state]);
  const { navigate } = useRouter();

  if (p.status === "error") {
    return (
      <div className="az-page">
        <Banner tone="danger">{p.error?.message ?? "Project not found."}</Banner>
        <div>
          <Button
            onClick={() => {
              navigate({ name: "home" });
            }}
          >
            Back to projects
          </Button>
        </div>
      </div>
    );
  }
  if (!p.data) return <p className="az-muted">Loading project…</p>;

  return (
    <div className="az-workspace" data-testid="workspace">
      <header className="az-workspace-header">
        <div>
          <h1 className="az-page-title" data-testid="project-name">
            {p.data.name}
          </h1>
          <div className="az-list-secondary">
            <code>{p.data.path}</code> · <Tag>{p.data.origin}</Tag>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => {
            navigate({ name: "home" });
          }}
        >
          All projects
        </Button>
      </header>

      <section className="az-pane az-pane-request" aria-label="Request">
        <h2 className="az-pane-title">Request</h2>
        <RequestPane projectId={id} activeTaskId={activeTaskId} live={live} onTaskStarted={setActiveTaskId} />
      </section>

      <section className="az-pane az-pane-work" aria-label="Work">
        <Tabs
          tabs={WORK_TABS}
          activeId={tab}
          onChange={(t) => {
            setTab(t as WorkTab);
          }}
        />
        <div className="az-pane-body">
          {tab === "transcript" ? (
            <TranscriptPanel projectId={id} activeTaskId={activeTaskId} live={live} />
          ) : tab === "plan" ? (
            <PlanPanel taskId={activeTaskId} live={live} />
          ) : tab === "execution" ? (
            <ExecutionPanel taskId={activeTaskId} live={live} />
          ) : tab === "changes" ? (
            <ChangesPanel taskId={activeTaskId} />
          ) : tab === "blueprint" ? (
            <BlueprintPanel projectId={id} />
          ) : tab === "memory" ? (
            <MemoryPanel projectId={id} />
          ) : tab === "project" ? (
            <ProjectPanel project={p.data} />
          ) : (
            <EmptyState>{EMPTY_COPY[tab]}</EmptyState>
          )}
        </div>
      </section>

      <section className="az-pane az-pane-preview" aria-label="Preview">
        <h2 className="az-pane-title">Preview</h2>
        <PreviewPane projectId={id} />
      </section>

      <Dock projectId={id} />
    </div>
  );
}

const EMPTY_COPY: Record<
  Exclude<WorkTab, "transcript" | "plan" | "execution" | "changes" | "blueprint" | "memory" | "project">,
  string
> = {
  validation: "Typecheck, lint, test and build results will be shown here.",
};

function BlueprintPanel({ projectId }: { readonly projectId: string }) {
  const input = useMemo(() => ({ projectId }), [projectId]);
  const bp = useQuery(blueprint.blueprintGet, input);
  const reqs = useQuery(blueprint.requirementsList, input);
  const save = useCommand(blueprint.blueprintSave);
  const approve = useCommand(blueprint.blueprintApprove);
  const sync = useCommand(blueprint.requirementsSync);
  const ids = { name: useId(), summary: useId() };
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");

  if (bp.status === "loading") return <p className="az-muted">Loading blueprint…</p>;
  const current = bp.data ?? null;
  const error = save.error ?? approve.error ?? sync.error;

  return (
    <div className="az-stack">
      {error ? <Banner tone="danger">{error.message}</Banner> : null}
      {current ? (
        <Card
          title={`Blueprint v${String(current.version)}`}
          description={current.approvedAt ? "Approved" : "Draft — approve to plan against it."}
        >
          <dl className="az-dl">
            <dt>Product</dt>
            <dd>{current.document.product.name}</dd>
            <dt>Summary</dt>
            <dd>{current.document.product.summary || <span className="az-muted">—</span>}</dd>
            <dt>Pages</dt>
            <dd>{current.document.pages.length}</dd>
            <dt>Entities</dt>
            <dd>{current.document.entities.length}</dd>
            <dt>Acceptance criteria</dt>
            <dd>{current.document.acceptance_criteria.length}</dd>
          </dl>
          <div className="az-row">
            {!current.approvedAt ? (
              <Button
                variant="primary"
                size="sm"
                disabled={approve.pending}
                onClick={() => void approve.run({ projectId, version: current.version })}
              >
                Approve
              </Button>
            ) : null}
            <Button size="sm" disabled={sync.pending} onClick={() => void sync.run({ projectId })}>
              Derive requirements
            </Button>
          </div>
        </Card>
      ) : (
        <EmptyState>
          No blueprint yet. Capture the product name and a summary to start one; the planner refines it later.
        </EmptyState>
      )}

      <Card title={current ? "New version" : "Start blueprint"}>
        <form
          className="az-stack"
          aria-label="Blueprint form"
          onSubmit={(e) => {
            e.preventDefault();
            void save
              .run({
                projectId,
                document: {
                  ...(current?.document ??
                    blueprint.BlueprintDocumentSchema.parse({ product: { name: name.trim() } })),
                  product: {
                    ...(current?.document.product ?? { goals: [] }),
                    name: name.trim(),
                    summary: summary.trim(),
                  },
                },
              })
              .then((saved) => {
                if (saved) {
                  setName("");
                  setSummary("");
                }
              });
          }}
        >
          <Field label="Product name" htmlFor={ids.name}>
            <TextInput
              id={ids.name}
              value={name}
              required
              maxLength={120}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </Field>
          <Field label="Summary" htmlFor={ids.summary}>
            <TextArea
              id={ids.summary}
              rows={3}
              value={summary}
              maxLength={2000}
              onChange={(e) => {
                setSummary(e.target.value);
              }}
            />
          </Field>
          <div className="az-row">
            <Button type="submit" variant="primary" disabled={save.pending || !name.trim()}>
              {save.pending ? "Saving…" : current ? "Save as new version" : "Create blueprint"}
            </Button>
          </div>
        </form>
      </Card>

      {reqs.data && reqs.data.requirements.length > 0 ? (
        <Card
          title="Requirements"
          description="Derived from the blueprint; statuses update as the reviewer verifies them."
        >
          <ul className="az-list" aria-label="Requirements">
            {reqs.data.requirements.map((r) => (
              <li key={r.id} className="az-list-row">
                <code>{r.id}</code>
                <span className="az-list-grow">{r.title}</span>
                <Tag>{r.status}</Tag>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

const CATEGORIES: readonly MemoryCategory[] = [
  "architecture",
  "conventions",
  "decisions",
  "constraints",
  "glossary",
  "preferences",
  "other",
];

function MemoryPanel({ projectId }: { readonly projectId: string }) {
  const input = useMemo(() => ({ projectId, includeSuperseded: false }), [projectId]);
  const items = useQuery(memory.memoryList, input);
  const add = useCommand(memory.memoryAdd);
  const remove = useCommand(memory.memoryDelete);
  const ids = { category: useId(), statement: useId() };
  const [category, setCategory] = useState<MemoryCategory>("conventions");
  const [statement, setStatement] = useState("");

  return (
    <div className="az-stack">
      {(add.error ?? remove.error) ? (
        <Banner tone="danger">{(add.error ?? remove.error)?.message}</Banner>
      ) : null}
      {items.data && items.data.length > 0 ? (
        <ul className="az-list" aria-label="Project memory">
          {items.data.map((m) => (
            <li key={m.id} className="az-list-row">
              <Tag>{m.category}</Tag>
              <span className="az-list-grow">{m.statement}</span>
              <span className="az-list-secondary">
                {m.provenanceTaskId ? `task ${m.provenanceTaskId}` : "user"}
              </span>
              <Button
                variant="danger"
                size="sm"
                disabled={remove.pending}
                onClick={() => void remove.run({ id: m.id })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : items.data ? (
        <EmptyState>
          No facts recorded yet. Add conventions or constraints the agent should always respect.
        </EmptyState>
      ) : null}
      <Card title="Add a fact">
        <form
          className="az-stack"
          aria-label="Add memory"
          onSubmit={(e) => {
            e.preventDefault();
            void add
              .run({ projectId, category, statement: statement.trim(), confidence: 1 })
              .then((saved) => {
                if (saved) setStatement("");
              });
          }}
        >
          <Field label="Category" htmlFor={ids.category}>
            <Select
              id={ids.category}
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as MemoryCategory);
              }}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Statement" htmlFor={ids.statement}>
            <TextInput
              id={ids.statement}
              value={statement}
              required
              maxLength={2000}
              placeholder="e.g. Use TanStack Query for server state"
              onChange={(e) => {
                setStatement(e.target.value);
              }}
            />
          </Field>
          <div className="az-row">
            <Button type="submit" variant="primary" disabled={add.pending || !statement.trim()}>
              Add
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function ProjectPanel({ project: p }: { readonly project: project.Project }) {
  const settingsInput = useMemo(() => ({ projectId: p.id }), [p.id]);
  const ps = useQuery(project.projectSettingsGet, settingsInput);
  const updateSettings = useCommand(project.projectSettingsUpdate);
  const rename = useCommand(project.projectRename);
  const del = useCommand(project.projectDelete);
  const { navigate } = useRouter();
  const ids = { name: useId(), profile: useId(), budget: useId(), deleteFiles: useId(), confirm: useId() };
  const [name, setName] = useState(p.name);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [confirm, setConfirm] = useState("");
  const managed = p.origin !== "imported";

  return (
    <div className="az-stack">
      <GitPanel projectId={p.id} />
      <Card title="Project settings">
        {(rename.error ?? updateSettings.error) ? (
          <Banner tone="danger">{(rename.error ?? updateSettings.error)?.message}</Banner>
        ) : null}
        <Field label="Name" htmlFor={ids.name}>
          <div className="az-row">
            <TextInput
              id={ids.name}
              value={name}
              maxLength={80}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
            <Button
              size="sm"
              disabled={rename.pending || name.trim() === p.name || !name.trim()}
              onClick={() => void rename.run({ id: p.id, name: name.trim() })}
            >
              Rename
            </Button>
          </div>
        </Field>
        {ps.data ? (
          <>
            <Field
              label="Runtime profile"
              htmlFor={ids.profile}
              hint="Where project processes run. Container isolation arrives with the Runtime Supervisor."
            >
              <Select
                id={ids.profile}
                value={ps.data.runtimeProfile}
                onChange={(e) =>
                  void updateSettings.run({
                    projectId: p.id,
                    patch: { runtimeProfile: e.target.value as "host" | "container" },
                  })
                }
              >
                <option value="host">Host (this machine)</option>
                <option value="container">Container</option>
              </Select>
            </Field>
            <Field label="Context budget (tokens)" htmlFor={ids.budget}>
              <TextInput
                id={ids.budget}
                type="number"
                min={4000}
                max={400000}
                step={1000}
                defaultValue={ps.data.contextBudgetTokens}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v !== ps.data?.contextBudgetTokens) {
                    void updateSettings.run({ projectId: p.id, patch: { contextBudgetTokens: v } });
                  }
                }}
              />
            </Field>
          </>
        ) : null}
      </Card>

      <PermissionsPanel projectId={p.id} />

      <Card
        title="Remove project"
        description={
          managed
            ? "Removing from the list keeps the files unless you choose to delete them."
            : "This folder was imported in place; AutoAPPZ never deletes it."
        }
      >
        {del.error ? <Banner tone="danger">{del.error.message}</Banner> : null}
        {managed ? (
          <Checkbox
            id={ids.deleteFiles}
            label="Also delete the project folder from disk"
            checked={deleteFiles}
            onChange={(e) => {
              setDeleteFiles(e.target.checked);
            }}
          />
        ) : null}
        {deleteFiles ? (
          <Field label={`Type “${p.name}” to confirm`} htmlFor={ids.confirm}>
            <TextInput
              id={ids.confirm}
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
              }}
            />
          </Field>
        ) : null}
        <div className="az-row">
          <Button
            variant="danger"
            disabled={del.pending || (deleteFiles && confirm !== p.name)}
            onClick={() => {
              void del
                .run({ id: p.id, deleteFiles, ...(deleteFiles ? { confirmName: confirm } : {}) })
                .then((r) => {
                  if (r !== undefined || !del.error) navigate({ name: "home" });
                });
            }}
          >
            {deleteFiles ? "Delete project and files" : "Remove from list"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
