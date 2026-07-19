// aegisClient.test.js — клиент AEGIS на фикстурах §4b (приведены после ревью A–G).
import { describe, it, expect } from "vitest";
import {
  createAegisClient,
  AegisError,
  normalizeWallet,
  walletToCacheRow,
  toAegisNetwork,
  fromAegisNetwork,
} from "./aegisClient.js";
import {
  FIX_REGISTER_CREATED,
  FIX_REGISTER_EXISTS,
  FIX_REGISTER_409,
  FIX_WALLET_OK,
  FIX_WALLET_WARNING,
  FIX_WALLET_DEGRADED,
  FIX_STATS_OK,
  FIX_STATS_UNAVAILABLE,
  FIX_TX_PAGE,
  FIX_TX_LAST_PAGE,
} from "./aegisFixtures.js";

// Мок fetch: маршрутизирует по (method, path-substr) → фикстура. headers по route.
function mockFetch(routes) {
  return async (url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    for (const rt of routes) {
      if (method === rt.method && url.includes(rt.match)) {
        const status = rt.status || 200;
        const hdrs = rt.headers || {};
        return {
          ok: status >= 200 && status < 300,
          status,
          headers: { get: (k) => hdrs[String(k).toLowerCase()] ?? null },
          text: async () => JSON.stringify(rt.body),
        };
      }
    }
    return {
      ok: false,
      status: 404,
      headers: { get: () => null },
      text: async () => JSON.stringify({ error: { code: "not_found", message: "no route" } }),
    };
  };
}

const mk = (routes) =>
  createAegisClient({ apiUrl: "https://aegis.test", apiKey: "k", fetchImpl: mockFetch(routes) });

describe("network mappers (G3: хранит TRC20, шлёт TRON)", () => {
  it("касса → AEGIS enum", () => {
    expect(toAegisNetwork("TRC20")).toBe("TRON");
    expect(toAegisNetwork("erc20")).toBe("ETHEREUM");
    expect(toAegisNetwork("btc")).toBe("BITCOIN");
  });
  it("AEGIS enum → канальное представление кассы", () => {
    expect(fromAegisNetwork("TRON")).toBe("TRC20");
    expect(fromAegisNetwork("ETHEREUM")).toBe("ERC20");
    expect(fromAegisNetwork("BITCOIN")).toBe("BTC");
  });
});

describe("registerWallet (§4b плоский ответ {wallet_id,…,created})", () => {
  it("created:true при первой регистрации", async () => {
    const c = mk([{ method: "POST", match: "/v1/wallets", body: FIX_REGISTER_CREATED }]);
    const r = await c.registerWallet({ address: "T...", network: "TRC20", label: "W88 Mark" });
    expect(r.created).toBe(true);
    expect(r.walletId).toBe("aegis_w_trc20_001");
    expect(r.network).toBe("TRC20"); // enum TRON → канальное TRC20
  });

  it("created:false (повтор) — норма, не ошибка", async () => {
    const c = mk([{ method: "POST", match: "/v1/wallets", body: FIX_REGISTER_EXISTS }]);
    const r = await c.registerWallet({ address: "T...", network: "TRC20", label: "W88 Mark" });
    expect(r.created).toBe(false);
    expect(r.walletId).toBe("aegis_w_trc20_001");
  });

  it("409 address_unavailable → AegisError с кодом", async () => {
    const c = mk([{ method: "POST", match: "/v1/wallets", status: 409, body: FIX_REGISTER_409.body }]);
    await expect(c.registerWallet({ address: "T...", network: "TRC20", label: "x" })).rejects.toMatchObject({
      name: "AegisError",
      status: 409,
      code: "address_unavailable",
    });
  });
});

describe("getWallet — нормализация §4b", () => {
  it("ok: usd_est строкой, native/usdt минор, риск+score, last_activity", async () => {
    const c = mk([{ method: "GET", match: "/v1/wallets/", body: FIX_WALLET_OK }]);
    const w = await c.getWallet("aegis_w_trc20_001");
    expect(w.riskLevel).toBe("ok");
    expect(w.riskScore).toBe(2);
    expect(w.balanceUsdEst).toBe("12500.40");
    expect(typeof w.balanceUsdEst).toBe("string"); // строка, не число
    expect(w.balanceNative).toMatchObject({ amount: "1500000000", decimals: 6, symbol: "TRX" });
    expect(w.balanceUsdt).toMatchObject({ amount: "12500400000", decimals: 6 });
    expect(w.lastActivityAt).toBe("2026-07-19T08:40:00.000Z");
    expect(w.dataUnavailable).toEqual([]);
    expect(w.riskReasons).toEqual([]);
  });

  it("warning: reasons как {code,message}", async () => {
    const c = mk([{ method: "GET", match: "/v1/wallets/", body: FIX_WALLET_WARNING }]);
    const w = await c.getWallet("aegis_w_erc20_002");
    expect(w.riskLevel).toBe("warning");
    expect(w.riskScore).toBe(55);
    expect(w.riskReasons.map((r) => r.message)).toContain("Unusual outflow velocity in last 24h");
    expect(w.riskReasons.every((r) => typeof r.code === "string")).toBe(true);
  });

  it("degraded: data_unavailable[balance] → balance null (НЕ 0), секция в списке", async () => {
    const c = mk([{ method: "GET", match: "/v1/wallets/", body: FIX_WALLET_DEGRADED }]);
    const w = await c.getWallet("aegis_w_erc20_004");
    expect(w.capability).toBe("degraded");
    expect(w.balanceUsdEst).toBeNull();
    expect(w.balanceNative).toBeNull();
    expect(w.dataUnavailable).toContain("balance");
  });
});

describe("walletToCacheRow", () => {
  it("доступный баланс → пишем balance_usd_est + synced_at (now)", () => {
    const row = walletToCacheRow(normalizeWallet(FIX_WALLET_OK));
    expect(row.risk_level).toBe("ok");
    expect(row.balance_usd_est).toBe("12500.40");
    expect(row.synced_at).toBeTruthy();
  });

  it("degraded → НЕ затираем баланс (нет ключа), но риск/capability обновляем", () => {
    const row = walletToCacheRow(normalizeWallet(FIX_WALLET_DEGRADED));
    expect(row).not.toHaveProperty("balance_usd_est");
    expect(row).not.toHaveProperty("synced_at");
    expect(row.aegis_capability).toBe("degraded");
  });
});

describe("getStats — §4b in/out + by_day", () => {
  it("ok: in/out суммы строкой, by_day есть", async () => {
    const c = mk([{ method: "GET", match: "/stats", body: FIX_STATS_OK }]);
    const s = await c.getStats("id", "2026-07-01", "2026-07-19");
    expect(s.available).toBe(true);
    expect(s.in.count).toBe(12);
    expect(s.in.sumUsd).toBe("1500.00");
    expect(s.out.sumUsd).toBe("900.00");
    expect(s.byDay).toHaveLength(2);
    expect(s.byDay[0]).toMatchObject({ date: "2026-07-18", inUsd: "500.00", outCount: 1 });
  });

  it("degraded: available false, секции null", async () => {
    const c = mk([{ method: "GET", match: "/stats", body: FIX_STATS_UNAVAILABLE }]);
    const s = await c.getStats("id", "2020-01-01", "2026-07-19");
    expect(s.available).toBe(false);
    expect(s.in).toBeNull();
    expect(s.byDay).toBeNull();
  });
});

describe("getTransactions — §4b items + cursor + has_more", () => {
  it("страница: amount токен-минор, counterparty_risk, has_more", async () => {
    const c1 = mk([{ method: "GET", match: "/transactions", body: FIX_TX_PAGE }]);
    const p1 = await c1.getTransactions("id", { cursor: null });
    expect(p1.items).toHaveLength(2);
    expect(p1.items[0].amount).toMatchObject({ amount: "1000000000", decimals: 6 });
    expect(p1.items[1].counterpartyRisk.categories).toContain("BLACKLIST");
    expect(p1.cursor).toBe("cursor_page2");
    expect(p1.hasMore).toBe(true);
  });

  it("последняя страница: items пусто, cursor null, has_more false", async () => {
    const c2 = mk([{ method: "GET", match: "/transactions", body: FIX_TX_LAST_PAGE }]);
    const p2 = await c2.getTransactions("id", { cursor: "cursor_page2" });
    expect(p2.items).toHaveLength(0);
    expect(p2.cursor).toBeNull();
    expect(p2.hasMore).toBe(false);
  });
});

describe("429 Retry-After (G1)", () => {
  it("429 → AegisError.retryAfter из заголовка", async () => {
    const c = mk([{ method: "GET", match: "/v1/wallets/", status: 429, headers: { "retry-after": "30" }, body: { error: { code: "rate_limited", message: "slow down" } } }]);
    await expect(c.getWallet("x")).rejects.toMatchObject({ status: 429, code: "rate_limited", retryAfter: 30 });
  });
});

describe("auth header (A1)", () => {
  it("шлёт X-API-Key, не Authorization", async () => {
    let seen = null;
    const c = createAegisClient({
      apiUrl: "https://aegis.test",
      apiKey: "secret-key",
      fetchImpl: async (_url, opts) => {
        seen = opts.headers;
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(FIX_WALLET_OK) };
      },
    });
    await c.getWallet("id");
    expect(seen["X-API-Key"]).toBe("secret-key");
    expect(seen.authorization).toBeUndefined();
  });
});

describe("not configured", () => {
  it("без URL/KEY → AegisError not_configured 503", async () => {
    const c = createAegisClient({ apiUrl: "", apiKey: "", fetchImpl: async () => ({}) });
    expect(c.configured()).toBe(false);
    await expect(c.getWallet("x")).rejects.toBeInstanceOf(AegisError);
    await expect(c.getWallet("x")).rejects.toMatchObject({ code: "not_configured", status: 503 });
  });
});
