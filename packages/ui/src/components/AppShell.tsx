import type { ReactNode } from "react";

export interface NavItem {
  readonly id: string;
  readonly label: string;
}

export interface AppShellProps {
  readonly brand: string;
  readonly nav: readonly NavItem[];
  readonly activeId: string;
  readonly onNavigate: (id: string) => void;
  readonly footer?: ReactNode;
  readonly children?: ReactNode;
}

/** Sidebar + main region. Purely presentational; navigation state belongs to the caller. */
export function AppShell({ brand, nav, activeId, onNavigate, footer, children }: AppShellProps) {
  return (
    <div className="az-shell">
      <aside className="az-sidebar">
        <div className="az-sidebar-brand">{brand}</div>
        <nav className="az-nav" aria-label="Primary">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              className="az-nav-item"
              aria-current={item.id === activeId ? "page" : undefined}
              onClick={() => {
                onNavigate(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        {footer ? <div className="az-sidebar-footer">{footer}</div> : null}
      </aside>
      <main className="az-main">{children}</main>
    </div>
  );
}

export function Page({
  title,
  subtitle,
  children,
}: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className="az-page">
      <header>
        <h1 className="az-page-title">{title}</h1>
        {subtitle ? <p className="az-page-subtitle">{subtitle}</p> : null}
      </header>
      {children}
    </div>
  );
}
