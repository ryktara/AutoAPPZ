import { describe, expect, it } from "vitest";
import { computeKpis, revenueByDay, sampleOrders, sortOrders } from "./data.ts";

describe("dashboard data", () => {
  it("is deterministic and the KPIs add up", () => {
    const a = sampleOrders(20, 3);
    const b = sampleOrders(20, 3);
    expect(a).toEqual(b);
    const kpis = computeKpis(a);
    expect(kpis.orders).toBe(20);
    expect(kpis.revenue).toBeCloseTo(
      a.filter((o) => o.status === "paid").reduce((s, o) => s + o.amount, 0),
      2,
    );
    expect(revenueByDay(a)).toHaveLength(30);
  });

  it("sorts by any column in both directions", () => {
    const orders = sampleOrders(10);
    const asc = sortOrders(orders, "amount", "asc").map((o) => o.amount);
    expect([...asc].sort((x, y) => x - y)).toEqual(asc);
    const desc = sortOrders(orders, "customer", "desc").map((o) => o.customer);
    expect([...desc].sort().reverse()).toEqual(desc);
  });
});
