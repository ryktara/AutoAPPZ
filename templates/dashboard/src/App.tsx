import { useMemo, useState } from "react";
import { DataTable } from "./components/DataTable.tsx";
import { LineChart } from "./components/LineChart.tsx";
import { computeKpis, formatMoney, revenueByDay, sampleOrders } from "./data.ts";

const VIEWS = ["Overview", "Orders", "Settings"] as const;

export function App() {
  const [view, setView] = useState<(typeof VIEWS)[number]>("Overview");
  const orders = useMemo(() => sampleOrders(), []);
  const kpis = useMemo(() => computeKpis(orders), [orders]);
  const byDay = useMemo(() => revenueByDay(orders), [orders]);
  return (
    <div className="layout">
      <nav className="sidebar" aria-label="Sections">
        <h1>Dashboard</h1>
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            className={v === view ? "active" : ""}
            aria-current={v === view ? "page" : undefined}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
      </nav>
      <main className="content">
        {view === "Overview" ? (
          <>
            <section className="kpis" aria-label="Key metrics">
              <Kpi label="Revenue" value={formatMoney(kpis.revenue)} />
              <Kpi label="Orders" value={String(kpis.orders)} />
              <Kpi label="Average order" value={formatMoney(kpis.averageOrder)} />
              <Kpi label="Refund rate" value={`${String(kpis.refundRate)}%`} />
            </section>
            <LineChart values={byDay} title="Revenue by day" />
          </>
        ) : view === "Orders" ? (
          <DataTable orders={orders} />
        ) : (
          <section className="panel">
            <h2>Settings</h2>
            <p>
              Replace the sample data in <code>src/data.ts</code> with your API.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
    </div>
  );
}
