export interface Order {
  id: string;
  customer: string;
  region: "North" | "South" | "East" | "West";
  amount: number;
  status: "paid" | "pending" | "refunded";
  day: number;
}

/** Deterministic sample data (seeded LCG) so the dashboard looks the same on every machine and in tests. */
export function sampleOrders(count = 60, seed = 7): Order[] {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  const customers = ["Acme", "Globex", "Initech", "Umbrella", "Stark", "Wayne", "Hooli", "Vandelay"];
  const regions: Order["region"][] = ["North", "South", "East", "West"];
  const statuses: Order["status"][] = ["paid", "paid", "paid", "pending", "refunded"];
  return Array.from({ length: count }, (_, i) => ({
    id: `ORD-${String(1000 + i)}`,
    customer: customers[Math.floor(next() * customers.length)] ?? "Acme",
    region: regions[Math.floor(next() * regions.length)] ?? "North",
    amount: Math.round((20 + next() * 480) * 100) / 100,
    status: statuses[Math.floor(next() * statuses.length)] ?? "paid",
    day: 1 + Math.floor(next() * 30),
  }));
}

export interface Kpis {
  revenue: number;
  orders: number;
  averageOrder: number;
  refundRate: number;
}

export function computeKpis(orders: readonly Order[]): Kpis {
  const paid = orders.filter((o) => o.status === "paid");
  const revenue = paid.reduce((sum, o) => sum + o.amount, 0);
  const refunded = orders.filter((o) => o.status === "refunded").length;
  return {
    revenue: Math.round(revenue * 100) / 100,
    orders: orders.length,
    averageOrder: paid.length > 0 ? Math.round((revenue / paid.length) * 100) / 100 : 0,
    refundRate: orders.length > 0 ? Math.round((refunded / orders.length) * 1000) / 10 : 0,
  };
}

/** Revenue per day (1..30) for the line chart. */
export function revenueByDay(orders: readonly Order[]): number[] {
  const days = Array.from({ length: 30 }, () => 0);
  for (const o of orders) if (o.status === "paid") days[o.day - 1] = (days[o.day - 1] ?? 0) + o.amount;
  return days.map((v) => Math.round(v * 100) / 100);
}

export type SortKey = keyof Pick<Order, "id" | "customer" | "region" | "amount" | "status" | "day">;

export function sortOrders(orders: readonly Order[], key: SortKey, direction: "asc" | "desc"): Order[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...orders].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * sign;
    return String(av).localeCompare(String(bv)) * sign;
  });
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}
