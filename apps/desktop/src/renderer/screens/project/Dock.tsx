import { useEffect, useMemo, useRef, useState } from "react";
import { runtime } from "@autoappz/contracts";
import { Button, EmptyState, Select, Tabs, Tag } from "@autoappz/ui";
import { useCommand, useQuery, useRuntime } from "../../state/hooks.ts";

const DOCK_TABS = [
  { id: "problems", label: "Problems" },
  { id: "logs", label: "Logs" },
  { id: "tests", label: "Tests" },
  { id: "terminal", label: "Terminal" },
] as const;
type DockTab = (typeof DOCK_TABS)[number]["id"];

export function Dock({ projectId }: { readonly projectId: string }) {
  const [tab, setTab] = useState<DockTab>("problems");
  return (
    <section className="az-dock" aria-label="Dock">
      <Tabs
        tabs={DOCK_TABS}
        activeId={tab}
        onChange={(t) => {
          setTab(t as DockTab);
        }}
      />
      <div className="az-dock-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "problems" ? (
          <ProblemsPanel projectId={projectId} />
        ) : tab === "logs" ? (
          <LogsPanel projectId={projectId} />
        ) : tab === "tests" ? (
          <EmptyState>Test results arrive with the validation milestone.</EmptyState>
        ) : (
          <EmptyState>
            An interactive terminal arrives in a later milestone. Runtime output is in Logs.
          </EmptyState>
        )}
      </div>
    </section>
  );
}

function ProblemsPanel({ projectId }: { readonly projectId: string }) {
  const diagnostics = useQuery(
    runtime.runtimeDiagnostics,
    useMemo(() => ({ projectId, limit: 200 }), [projectId]),
  );
  const clear = useCommand(runtime.runtimeClearDiagnostics);
  const list = diagnostics.data ?? [];
  if (list.length === 0) return <EmptyState>No problems reported.</EmptyState>;
  return (
    <div className="az-stack">
      <div className="az-row">
        <span className="az-muted">
          {list.length} problem{list.length === 1 ? "" : "s"}
        </span>
        <Button size="sm" disabled={clear.pending} onClick={() => void clear.run({ projectId })}>
          Clear
        </Button>
      </div>
      <ul className="az-list" aria-label="Problems">
        {[...list].reverse().map((d) => (
          <li key={d.id} className="az-list-row">
            <Tag>{d.severity}</Tag>
            <Tag>{d.source}</Tag>
            <span className="az-list-grow">
              <div>{d.message}</div>
              {d.file ? (
                <div className="az-list-secondary">
                  <code>
                    {d.file}
                    {d.line ? `:${String(d.line)}${d.column ? `:${String(d.column)}` : ""}` : ""}
                  </code>
                  {d.code ? ` · ${d.code}` : ""}
                </div>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LogsPanel({ projectId }: { readonly projectId: string }) {
  const { client } = useRuntime();
  const [phase, setPhase] = useState<runtime.Phase | "all">("all");
  const [lines, setLines] = useState<runtime.OutputLine[]>([]);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLines([]);
    const handle = client.stream(
      runtime.runtimeOutput,
      { projectId, afterSeq: 0 },
      {
        onChunk: (line) => {
          setLines((prev) => (prev.length >= 2000 ? [...prev.slice(-1500), line] : [...prev, line]));
        },
        onEnd: () => undefined,
        onError: () => undefined,
      },
    );
    return () => {
      handle.cancel();
    };
  }, [client, projectId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  const shown = phase === "all" ? lines : lines.filter((l) => l.phase === phase);
  return (
    <div className="az-stack" style={{ height: "100%" }}>
      <div className="az-row">
        <label className="az-sr-only" htmlFor="log-phase">
          Phase
        </label>
        <Select
          id="log-phase"
          value={phase}
          onChange={(e) => {
            setPhase(e.target.value as runtime.Phase | "all");
          }}
        >
          <option value="all">All phases</option>
          <option value="install">Install</option>
          <option value="serve">Dev server</option>
          <option value="build">Build</option>
          <option value="test">Tests</option>
        </Select>
        <span className="az-muted">{shown.length} lines</span>
      </div>
      {shown.length === 0 ? (
        <EmptyState>No runtime output yet.</EmptyState>
      ) : (
        <pre className="az-log" aria-label="Runtime logs" data-testid="runtime-logs">
          {shown.map((l) => (
            <span key={l.seq} className={`az-log-${l.stream}`}>
              [{l.phase}] {l.text}
              {"\n"}
            </span>
          ))}
          <div ref={bottom} />
        </pre>
      )}
    </div>
  );
}
