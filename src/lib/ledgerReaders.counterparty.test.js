import { describe, it, expect, vi, beforeEach } from "vitest";

const tableResponses = {};
vi.mock("./supabase.js", () => ({
  isSupabaseConfigured: true,
  supabase: { from: (t) => ({ select: () => Promise.resolve(tableResponses[t] || { data: [], error: null }) }) },
}));

import { loadCounterpartyNames } from "./ledgerReaders.js";

describe("loadCounterpartyNames", () => {
  beforeEach(() => { Object.keys(tableResponses).forEach((k) => delete tableResponses[k]); });

  it("returns { map, clients, partners } — clients use nickname||full_name, partners use name, id-prefix fallback", async () => {
    tableResponses.clients = { data: [
      { id: "c1", nickname: "Иван", full_name: "Иван Петров" },
      { id: "c2", nickname: null, full_name: "No Nick" },
      { id: "00000000-0000-4000-8000-000000000001", nickname: null, full_name: null },
    ], error: null };
    tableResponses.partners = { data: [{ id: "p1", name: "OTC Acme" }], error: null };
    const r = await loadCounterpartyNames();
    expect(r.map.get("c1")).toBe("Иван");
    expect(r.map.get("c2")).toBe("No Nick");
    expect(r.map.get("00000000-0000-4000-8000-000000000001")).toBe("00000000");
    expect(r.map.get("p1")).toBe("OTC Acme");
    expect(r.clients).toEqual([
      { id: "c1", name: "Иван" },
      { id: "c2", name: "No Nick" },
      { id: "00000000-0000-4000-8000-000000000001", name: "00000000" },
    ]);
    expect(r.partners).toEqual([{ id: "p1", name: "OTC Acme" }]);
  });

  it("throws on a supabase error", async () => {
    tableResponses.clients = { data: null, error: { message: "boom" } };
    await expect(loadCounterpartyNames()).rejects.toThrow(/boom/);
  });
});
