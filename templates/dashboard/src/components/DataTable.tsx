import { useMemo, useState } from "react";
import { formatMoney, sortOrders, type Order, type SortKey } from "../data.ts";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "id", label: "Order" },
  { key: "customer", label: "Customer" },
  { key: "region", label: "Region" },
  { key: "status", label: "Status" },
  { key: "day", label: "Day" },
  { key: "amount", label: "Amount" },
];

export function DataTable({ orders }: { orders: readonly Order[] }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "day",
    direction: "desc",
  });
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? orders.filter((o) => `${o.id} ${o.customer} ${o.region} ${o.status}`.toLowerCase().includes(q))
      : orders;
    return sortOrders(filtered, sort.key, sort.direction);
  }, [orders, sort, filter]);
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Orders</h2>
        <input
          aria-label="Filter orders"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <table>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key}>
                <button
                  type="button"
                  onClick={() =>
                    setSort({
                      key: c.key,
                      direction: sort.key === c.key && sort.direction === "asc" ? "desc" : "asc",
                    })
                  }
                >
                  {c.label}
                  {sort.key === c.key ? (sort.direction === "asc" ? " ▲" : " ▼") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td>{o.id}</td>
              <td>{o.customer}</td>
              <td>{o.region}</td>
              <td>
                <span className={`badge badge-${o.status}`}>{o.status}</span>
              </td>
              <td>{o.day}</td>
              <td className="num">{formatMoney(o.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
