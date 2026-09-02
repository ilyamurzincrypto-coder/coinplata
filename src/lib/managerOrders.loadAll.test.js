// Журнал заявок: вкладка «Все» обязана показывать историю целиком.
//
// Запрос был прибит к status='pending', и касса показывала 9 заявок при 103 в
// базе — закрытая заявка исчезала бесследно, вместе с ответом на вопрос «а
// что было с тем клиентом».
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = [];
const chain = () => {
  const q = {
    select: vi.fn(() => q),
    order: vi.fn(() => q),
    limit: vi.fn((n) => { calls.at(-1).limit = n; return q; }),
    eq: vi.fn((col, val) => { calls.at(-1).eq.push([col, val]); return q; }),
    then: (res) => res({ data: [], error: null }),
  };
  return q;
};

vi.mock("./supabase.js", () => ({
  supabase: { from: (t) => { calls.push({ table: t, eq: [], limit: null }); return chain(); } },
}));
vi.mock("./uuid.js", () => ({ assertOfficeId: () => {} }));

const OFFICE = "cc51b231-6ea6-47f4-82cc-04028351f128";

describe("loadPendingOrders", () => {
  beforeEach(() => {
    calls.length = 0;
    // Модуль читает флаг при импорте — ставим его до динамического import.
    vi.stubEnv("VITE_MANAGER_ORDERS_ENABLED", "true");
    vi.resetModules();
  });

  it("по умолчанию — только ожидающие", async () => {
    const { loadPendingOrders } = await import("./managerOrders.js");
    await loadPendingOrders(OFFICE);
    expect(calls[0].eq).toContainEqual(["status", "pending"]);
  });

  it("all: true — без фильтра по статусу, но с офисом и лимитом", async () => {
    const { loadPendingOrders, ORDERS_LIMIT } = await import("./managerOrders.js");
    await loadPendingOrders(OFFICE, { all: true });
    const cols = calls[0].eq.map(([c]) => c);
    expect(cols).not.toContain("status");
    expect(calls[0].eq).toContainEqual(["office_id", OFFICE]);
    expect(calls[0].limit).toBe(ORDERS_LIMIT);
  });
});
