import type { ReactNode } from "react";

export interface AppShellProps {
  readonly title: string;
  readonly status?: ReactNode;
  readonly children?: ReactNode;
}

/** Root layout: header + main region. Purely presentational. */
export function AppShell({ title, status, children }: AppShellProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-sans)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-3) var(--space-4)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>{title}</h1>
        <div style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>{status}</div>
      </header>
      <main style={{ flex: 1, padding: "var(--space-4)" }}>{children}</main>
    </div>
  );
}
