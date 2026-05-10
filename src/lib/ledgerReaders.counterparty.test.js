import { describe, it, expect, vi, beforeEach } from "vitest";

const tableResponses = {};
vi.mock("./supabase.js", () => ({
  isSupabaseConfigured: true,
  supabase: { from: (t) => ({ select: () => Promise.resolve(tableResponses[t] || { data: [], error: null }) }) },
}));

import { loadCounterpartyNames } from "./ledgerReaders.js";

describe("loadCounterpartyNames", () => {
  beforeEach(() => { Object.keys(tableResponses).forEach((k) => delete tableResponses[k]); });

  it("merges clients (nickname||full_name) and partners (name); id-prefix fallback", async () => {
    tableResponses.clients = { data: [
      { id: "c1", nickname: "Иван", full_name: "Иван Петров" },
      { id: "c2", nickname: null, full_name: "No Nick" },
      { id: "00000000-0000-4000-8000-000000000001", nickname: null, full_name: null },
    ], error: null };
    tableResponses.partners = { data: [{ id: "p1", name: "OTC Acme" }], error: null };
    const m = await loadCounterpartyNames();
    expect(m.get("c1")).toBe("Иван");
    expect(m.get("c2")).toBe("No Nick");
    expect(m.get("00000000-0000-4000-8000-000000000001")).toBe("00000000");
    expect(m.get("p1")).toBe("OTC Acme");
  });

  it("throws on a supabase error", async () => {
    tableResponses.clients = { data: null, error: { message: "boom" } };
    await expect(loadCounterpartyNames()).rejects.toThrow(/boom/);
  });
});
