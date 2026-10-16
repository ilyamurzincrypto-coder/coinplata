// Крон-добивка: берёт последнюю НЕдоставленную публикацию и только её.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { latestUndelivered } from "./_deliver.js";

const SUPA = "https://db.example";
const svc = "svc-key";

function mockRows(rows) {
  return vi.fn(async () => ({ ok: true, json: async () => rows }));
}

beforeEach(() => { global.fetch = mockRows([]); });
afterEach(() => { vi.restoreAllMocks(); });

describe("latestUndelivered", () => {
  it("возвращает версию, застрявшую в pending", async () => {
    global.fetch = mockRows([{ version: 29, delivery_state: "pending", delivery_attempts: 0 }]);
    expect(await latestUndelivered({ supaUrl: SUPA, svc })).toMatchObject({ version: 29 });
  });

  it("возвращает версию с провалившейся доставкой", async () => {
    global.fetch = mockRows([{ version: 30, delivery_state: "failed", delivery_attempts: 4 }]);
    expect(await latestUndelivered({ supaUrl: SUPA, svc })).toMatchObject({ version: 30 });
  });

  it("публикацию без статуса считает недоставленной", async () => {
    global.fetch = mockRows([{ version: 31, delivery_state: null }]);
    expect(await latestUndelivered({ supaUrl: SUPA, svc })).toMatchObject({ version: 31 });
  });

  it("доставленную не трогает", async () => {
    global.fetch = mockRows([{ version: 28, delivery_state: "sent" }]);
    expect(await latestUndelivered({ supaUrl: SUPA, svc })).toBeNull();
  });

  it("при выключенном мосте (skipped) молчит — это осознанный dry-run, а не сбой", async () => {
    global.fetch = mockRows([{ version: 28, delivery_state: "skipped" }]);
    expect(await latestUndelivered({ supaUrl: SUPA, svc })).toBeNull();
  });

  it("смотрит только последнюю версию — старая застрявшая не воскрешается", async () => {
    // PostgREST отдаёт limit=1 с order=version.desc; проверяем, что запрос такой.
    global.fetch = vi.fn(async (url) => {
      expect(String(url)).toContain("order=version.desc");
      expect(String(url)).toContain("limit=1");
      return { ok: true, json: async () => [{ version: 28, delivery_state: "sent" }] };
    });
    expect(await latestUndelivered({ supaUrl: SUPA, svc })).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("пустая база — нечего добивать", async () => {
    global.fetch = mockRows([]);
    expect(await latestUndelivered({ supaUrl: SUPA, svc })).toBeNull();
  });
});
