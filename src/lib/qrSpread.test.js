// Спред QR: единственное правило, ради которого всё переносилось в базу —
// НИКОГДА не подставлять выдуманное число. Прошлый дефолт «1» молча уронил
// боевой спред с 8% и спрятал это.

import { describe, it, expect, vi, beforeEach } from "vitest";

const holder = vi.hoisted(() => ({ client: null }));
vi.mock("./supabase.js", () => ({
  get supabase() { return holder.client; },
  isSupabaseConfigured: true,
}));

import { loadQrSpread, saveQrSpread, canEditQrSpread, QR_SOURCE, QR_SPREAD_KEY } from "./qrSpread.js";

const clientReturning = (result) => ({
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => result }) }),
    update: () => ({ eq: async () => ({ error: null }) }),
  }),
});

beforeEach(() => {
  localStorage.clear();
  holder.client = null;
});

describe("loadQrSpread", () => {
  it("норма — значение из базы, кэш обновляется", async () => {
    holder.client = clientReturning({ data: { config: { spread_pct: 8 } }, error: null });
    const r = await loadQrSpread();
    expect(r).toEqual({ value: 8, source: QR_SOURCE.DB });
    expect(localStorage.getItem(QR_SPREAD_KEY)).toBe("8");
  });

  it("база недоступна — последнее известное, но с пометкой «кэш»", async () => {
    localStorage.setItem(QR_SPREAD_KEY, "8");
    holder.client = clientReturning({ data: null, error: { message: "network" } });
    const r = await loadQrSpread();
    expect(r).toEqual({ value: 8, source: QR_SOURCE.CACHE });
  });

  it("ни базы, ни кэша — null, А НЕ ЧИСЛО", async () => {
    // Здесь и жил инцидент: старый ридер возвращал «1» и панель считала
    // курс приёма рублей по чужому спреду, ничего не сказав.
    holder.client = clientReturning({ data: null, error: { message: "network" } });
    const r = await loadQrSpread();
    expect(r.value).toBeNull();
    expect(r.source).toBe(QR_SOURCE.NONE);
  });

  it("мусор в config не превращается в курс", async () => {
    holder.client = clientReturning({ data: { config: { spread_pct: "восемь" } }, error: null });
    expect((await loadQrSpread()).value).toBeNull();
  });
});

describe("saveQrSpread", () => {
  it("не-число не уходит в базу", async () => {
    holder.client = clientReturning({ data: { config: {} }, error: null });
    await expect(saveQrSpread("абв")).rejects.toThrow(/не число/);
  });

  it("ошибка записи не проглатывается", async () => {
    holder.client = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { config: {} }, error: null }) }) }),
        update: () => ({ eq: async () => ({ error: { message: "RLS" } }) }),
      }),
    };
    await expect(saveQrSpread(8)).rejects.toThrow(/RLS/);
  });

  it("запятая принимается — меняла печатает 0,5", async () => {
    holder.client = clientReturning({ data: { config: { provider: "cbr" } }, error: null });
    await expect(saveQrSpread("0,5")).resolves.toBe(0.5);
    expect(localStorage.getItem(QR_SPREAD_KEY)).toBe("0.5");
  });
});

describe("право правки", () => {
  it("owner и admin — да, менеджер — нет (RLS rate_blocks_update_admin)", () => {
    expect(canEditQrSpread({ role: "owner" })).toBe(true);
    expect(canEditQrSpread({ role: "admin" })).toBe(true);
    expect(canEditQrSpread({ role: "manager" })).toBe(false);
    expect(canEditQrSpread(null)).toBe(false);
  });
});
