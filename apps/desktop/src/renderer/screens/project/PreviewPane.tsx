import { useEffect, useMemo, useRef } from "react";
import { runtime } from "@autoappz/contracts";
import { Banner, Button, EmptyState, Tag } from "@autoappz/ui";
import { useCommand, useQuery, useRuntime } from "../../state/hooks.ts";

const PHASE_LABEL: Record<runtime.Phase, string> = {
  install: "Install",
  serve: "Dev server",
  build: "Build",
  test: "Tests",
  script: "Script",
};

/**
 * Preview pane: runtime controls per phase, the sandboxed preview iframe (loopback proxy origin only),
 * and the latest runtime error. Messages from the injected preview script are accepted only when they
 * come from the iframe's own window and origin (threat model B5).
 */
export function PreviewPane({ projectId }: { readonly projectId: string }) {
  const { client, cache } = useRuntime();
  const status = useQuery(
    runtime.runtimeStatus,
    useMemo(() => ({ projectId }), [projectId]),
  );
  const diagnostics = useQuery(
    runtime.runtimeDiagnostics,
    useMemo(() => ({ projectId, limit: 50 }), [projectId]),
  );
  const start = useCommand(runtime.runtimeStart);
  const stop = useCommand(runtime.runtimeStop);
  const restart = useCommand(runtime.runtimeRestart);
  const clear = useCommand(runtime.runtimeClearDiagnostics);
  const report = useCommand(runtime.runtimeReportPreviewEvent);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const previewUrl = status.data?.previewUrl;

  useEffect(() => {
    const off1 = client.on(runtime.runtimeStateChanged, (p) => {
      if (p.projectId === projectId) cache.invalidate(["runtime"]);
    });
    const off2 = client.on(runtime.runtimeDiagnostic, (d) => {
      if (d.projectId === projectId) cache.invalidate(["diagnostics"]);
    });
    return () => {
      off1();
      off2();
    };
  }, [client, cache, projectId]);

  useEffect(() => {
    if (!previewUrl) return;
    const origin = new URL(previewUrl).origin;
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data as { source?: unknown } | null;
      if (data?.source !== "autoappz-preview") return;
      const parsed = runtime.PreviewEventSchema.safeParse(data);
      if (parsed.success) void report.run({ projectId, event: parsed.data });
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [previewUrl, projectId, report]);

  const processes = status.data?.processes ?? [];
  const serve = processes.find((p) => p.phase === "serve");
  const error = start.error ?? stop.error ?? restart.error;
  const latestError = (diagnostics.data ?? []).filter((d) => d.severity === "error").at(-1);
  const busy = start.pending || stop.pending || restart.pending;

  return (
    <div className="az-preview" data-testid="preview">
      <div className="az-row" role="group" aria-label="Runtime controls">
        {(["install", "serve", "build"] as const).map((phase) => {
          const p = processes.find((x) => x.phase === phase);
          const live = p && p.state !== "STOPPED" && p.state !== "CRASHED";
          return (
            <span key={phase} className="az-row" data-testid={`runtime-${phase}`}>
              <Tag>
                {PHASE_LABEL[phase]}: {p?.state ?? "STOPPED"}
              </Tag>
              {live ? (
                <Button size="sm" disabled={busy} onClick={() => void stop.run({ projectId, phase })}>
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={phase === "serve" ? "primary" : "secondary"}
                  disabled={busy}
                  onClick={() => void start.run({ projectId, phase })}
                >
                  {phase === "serve" ? "Start" : "Run"}
                </Button>
              )}
              {phase === "serve" && live ? (
                <Button size="sm" disabled={busy} onClick={() => void restart.run({ projectId, phase })}>
                  Restart
                </Button>
              ) : null}
            </span>
          );
        })}
      </div>
      {error ? <Banner tone="danger">{error.message}</Banner> : null}
      {serve?.lastError && (serve.state === "CRASHED" || serve.state === "DEGRADED") ? (
        <Banner tone="danger">{serve.lastError}</Banner>
      ) : null}
      {latestError ? (
        <div data-testid="runtime-error-banner">
          <Banner tone="danger">
            <strong>
              {latestError.source === "preview" ? "Runtime error in the app" : `${latestError.source} error`}:
            </strong>{" "}
            {latestError.message}
            {latestError.file ? (
              <div className="az-list-secondary">
                {latestError.file}
                {latestError.line ? `:${String(latestError.line)}` : ""}
              </div>
            ) : null}
            <div className="az-row" style={{ marginTop: "var(--space-2)" }}>
              <Button
                size="sm"
                disabled
                title="Automatic diagnosis and repair arrives with the validation milestone"
              >
                Diagnose &amp; fix
              </Button>
              <Button size="sm" disabled={clear.pending} onClick={() => void clear.run({ projectId })}>
                Clear
              </Button>
            </div>
          </Banner>
        </div>
      ) : null}
      {previewUrl ? (
        <iframe
          ref={frame}
          title="Preview"
          className="az-preview-frame"
          src={previewUrl}
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
          referrerPolicy="no-referrer"
        />
      ) : (
        <EmptyState>
          {serve?.state === "STARTING"
            ? "Starting the dev server…"
            : "Run Install once, then Start the dev server to see your app here."}
        </EmptyState>
      )}
      {serve?.port ? (
        <p className="az-field-hint">
          Dev server on port {serve.port} · preview via {previewUrl ?? "—"} · health{" "}
          {serve.health
            ? serve.health.failures === 0
              ? "ok"
              : `${String(serve.health.failures)} failed probes`
            : "n/a"}
        </p>
      ) : null}
    </div>
  );
}
