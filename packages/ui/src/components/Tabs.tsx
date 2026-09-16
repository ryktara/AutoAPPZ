import { useRef, type KeyboardEvent } from "react";

export interface TabItem {
  readonly id: string;
  readonly label: string;
}

export interface TabsProps {
  readonly tabs: readonly TabItem[];
  readonly activeId: string;
  readonly onChange: (id: string) => void;
  readonly label?: string | undefined;
}

/** Accessible tab strip (roving tabindex, arrow-key navigation). Panels are rendered by the caller. */
export function Tabs({ tabs, activeId, onChange, label }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | undefined;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    const target = tabs[next];
    if (target) {
      onChange(target.id);
      refs.current[next]?.focus();
    }
  };
  return (
    <div role="tablist" aria-label={label} className="az-tabs">
      {tabs.map((t, i) => {
        const active = t.id === activeId;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active}
            aria-controls={`panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            className="az-tab"
            onClick={() => {
              onChange(t.id);
            }}
            onKeyDown={(e) => {
              onKeyDown(e, i);
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
