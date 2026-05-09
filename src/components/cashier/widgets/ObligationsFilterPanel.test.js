// Tests for ObligationsFilterPanel pure helpers (T_F1, T_F2, T_F3).

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  defaultFilters,
  loadFiltersFromStorage,
  applyFilters,
} from "./ObligationsFilterPanel.jsx";

describe("ObligationsFilterPanel — applyFilters", () => {
  const items = [
    { id: "1", status: "awaiting_payment", assigned_to: "u1", office_id: "o1", is_stale: false },
    { id: "2", status: "awaiting_release", assigned_to: "u2", office_id: "o1", is_stale: true },
    { id: "3", status: "partial",          assigned_to: "u1", office_id: "o2", is_stale: false },
    { id: "4", status: "draft",            assigned_to: "u2", office_id: "o2", is_stale: true },
  ];

  it("T_F1: status filter → only matching", () => {
    const f = { ...defaultFilters(), status: ["awaiting_payment"] };
    expect(applyFilters(items, f, "u1").map((i) => i.id)).toEqual(["1"]);
  });

  it("T_F2: stale filter → only is_stale=true", () => {
    const f = { ...defaultFilters(), stale: true };
    expect(applyFilters(items, f, "u1").map((i) => i.id)).toEqual(["2", "4"]);
  });

  it("owner=mine filter — только items с assigned_to=userId", () => {
    const f = { ...defaultFilters(), owner: "mine" };
    expect(applyFilters(items, f, "u1").map((i) => i.id)).toEqual(["1", "3"]);
  });

  it("office filter — только matching office", () => {
    const f = { ...defaultFilters(), office: "o2" };
    expect(applyFilters(items, f, "u1").map((i) => i.id)).toEqual(["3", "4"]);
  });

  it("default filters — все items проходят", () => {
    expect(applyFilters(items, defaultFilters(), "u1")).toHaveLength(4);
  });

  it("combined filters — AND", () => {
    const f = {
      status: ["awaiting_release", "partial"],
      owner: "mine",
      stale: false,
      office: null,
    };
    // u1 + (release|partial) + !stale → only id=3 (status=partial)
    expect(applyFilters(items, f, "u1").map((i) => i.id)).toEqual(["3"]);
  });
});

describe("ObligationsFilterPanel — localStorage persist", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") localStorage.clear();
  });
  afterEach(() => {
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  it("T_F3: load returns null without saved", () => {
    expect(loadFiltersFromStorage("user-1")).toBe(null);
  });

  it("T_F3: load returns saved filters after manual write", () => {
    if (typeof localStorage === "undefined") return; // skip in non-jsdom
    localStorage.setItem(
      "coinplata.openObligations.filters.user-1",
      JSON.stringify({
        status: ["draft"],
        owner: "mine",
        stale: true,
        office: "o1",
      })
    );
    const loaded = loadFiltersFromStorage("user-1");
    expect(loaded).toEqual({
      status: ["draft"],
      owner: "mine",
      stale: true,
      office: "o1",
    });
  });

  it("invalid json → null", () => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem("coinplata.openObligations.filters.user-1", "not-json");
    expect(loadFiltersFromStorage("user-1")).toBe(null);
  });

  it("no userId → null", () => {
    expect(loadFiltersFromStorage(null)).toBe(null);
    expect(loadFiltersFromStorage(undefined)).toBe(null);
  });
});
