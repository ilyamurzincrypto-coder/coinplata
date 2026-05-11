import { describe, it, expect } from "vitest";
import { bucketObligations, obligationLegTotals, PC_BUCKETS } from "./paymentCalendar.js";

// Fixed "now" = 2026-05-11 12:00 local; build due_dates relative to local midnight that day.
const NOW = new Date(2026, 4, 11, 12, 0, 0).getTime();
const D = (n) => { const d = new Date(2026, 4, 11, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString(); };

describe("bucketObligations", () => {
  it("buckets by due date: overdue / today / next 7 days / later / no date", () => {
    const items = [
      { id: "a", due_date: D(-2) },   // overdue
      { id: "b", due_date: D(0) },    // today
      { id: "c", due_date: D(3) },    // week
      { id: "d", due_date: D(6) },    // week (within 7)
      { id: "e", due_date: D(8) },    // later
      { id: "f", due_date: null },    // no date
      { id: "g", due_date: "not-a-date" }, // → no date
    ];
    const b = bucketObligations(items, NOW);
    expect(b.overdue.map((x) => x.id)).toEqual(["a"]);
    expect(b.today.map((x) => x.id)).toEqual(["b"]);
    expect(b.week.map((x) => x.id)).toEqual(["c", "d"]);
    expect(b.later.map((x) => x.id)).toEqual(["e"]);
    expect(b.no_date.map((x) => x.id).sort()).toEqual(["f", "g"]);
  });
  it("sorts dated buckets by due date ascending", () => {
    const b = bucketObligations([{ id: "x", due_date: D(5) }, { id: "y", due_date: D(2) }], NOW);
    expect(b.week.map((x) => x.id)).toEqual(["y", "x"]);
  });
  it("handles empty / nullish input", () => {
    expect(bucketObligations([], NOW)).toEqual({ overdue: [], today: [], week: [], later: [], no_date: [] });
    expect(bucketObligations(null, NOW).overdue).toEqual([]);
  });
  it("PC_BUCKETS lists the buckets in display order", () => {
    expect(PC_BUCKETS).toEqual(["overdue", "today", "week", "later", "no_date"]);
  });
});

describe("obligationLegTotals", () => {
  it("sums open legs per currency, sorted by currency", () => {
    expect(obligationLegTotals({ open_legs: [
      { currency: "USDT", amount: 100 },
      { currency: "USD", amount: 50 },
      { currency: "USDT", amount: 25 },
    ] })).toEqual([{ currency: "USD", amount: 50 }, { currency: "USDT", amount: 125 }]);
  });
  it("returns [] when there are no legs", () => {
    expect(obligationLegTotals({})).toEqual([]);
    expect(obligationLegTotals(null)).toEqual([]);
  });
});
