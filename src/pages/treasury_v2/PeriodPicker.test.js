import { describe, it, expect } from "vitest";
import { presetWindow, previousWindow } from "./PeriodPicker.jsx";

describe("presetWindow", () => {
  const NOW = new Date("2026-05-10T14:00:00Z"); // a Sunday
  it("today → start of day to end of day (to = end of current UTC day, not the exact instant)", () => {
    const w = presetWindow("today", NOW);
    expect(w.from).toBe("2026-05-10T00:00:00.000Z");
    expect(w.to).toBe("2026-05-10T23:59:59.999Z");
  });
  it("month → 1st of month", () => {
    const w = presetWindow("month", NOW);
    expect(w.from).toBe("2026-05-01T00:00:00.000Z");
  });
  it("year → Jan 1", () => {
    const w = presetWindow("year", NOW);
    expect(w.from).toBe("2026-01-01T00:00:00.000Z");
  });
  it("quarter → Apr 1 for May", () => {
    const w = presetWindow("quarter", NOW);
    expect(w.from).toBe("2026-04-01T00:00:00.000Z");
  });
  it("week → Monday of current week (May 4 for Sunday May 10)", () => {
    const w = presetWindow("week", NOW);
    expect(w.from).toBe("2026-05-04T00:00:00.000Z");
  });
  it("30d → 30 days ago", () => {
    const w = presetWindow("30d", NOW);
    expect(w.from).toBe("2026-04-10T14:00:00.000Z");
  });
});

describe("previousWindow", () => {
  it("returns the immediately-preceding window of the same length (prev.to === win.from)", () => {
    const win = { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" }; // 31 days
    const prev = previousWindow(win);
    expect(prev.to).toBe("2026-05-01T00:00:00.000Z");
    expect(prev.from).toBe("2026-03-31T00:00:00.000Z"); // 2026-05-01 minus 31 days
  });
  it("works for a sub-day-aligned 5-day window", () => {
    const win = { from: "2026-05-10T14:00:00.000Z", to: "2026-05-15T14:00:00.000Z" };
    const prev = previousWindow(win);
    expect(prev.to).toBe("2026-05-10T14:00:00.000Z");
    expect(prev.from).toBe("2026-05-05T14:00:00.000Z");
  });
});
