import { describe, it, expect } from "vitest";
import { presetWindow } from "./PeriodPicker.jsx";

describe("presetWindow", () => {
  const NOW = new Date("2026-05-10T14:00:00Z"); // a Sunday
  it("today → start of day to now", () => {
    const w = presetWindow("today", NOW);
    expect(w.from).toBe("2026-05-10T00:00:00.000Z");
    expect(w.to).toBe(NOW.toISOString());
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
