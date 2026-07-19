// aegisClient.test.js — клиент AEGIS на провизорных фикстурах §4b.
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

// Мок fetch: маршрутизирует по (method, path-substr) → фикстура.
function mockFetch(routes) {
  return async (url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    for (const rt of routes) {
      if (method === rt.method && url.includes(rt.match)) {
        const status = rt.status || 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          text: async () => JSON.stringify(rt.body),
        };
      }
    }
    return { ok: false, status: 404, text: async () => JSON.stringify({ error: { code: "not_found", message: "no route" } }) };
  };
}

const mk = (routes) =>
  createAegisClient({ apiUrl: "https://aegis.test", apiKey: "k", fetchImpl: mockFetch(routes) });

describe("network mappers", () => {
  it("касса ↔ AEGIS регистр", () => {
    expect(toAegisNetwork("TRC20")).toBe("trc20");
    expect(fromAegisNetwork("trc20")).toBe("TRC20");
  });
});

describe("registerWallet", () => {
  it("created:true при первой регистрации", async () => {
    const c = mk([{ method: "POST", match: "/v1/wallets", body: FIX_REGISTER_CREATED }]);
    const r = await c.registerWallet({ address: "T...", network: "TRC20", label: "W88 Mark" });
    expect(r.created).toBe(true);
    expect(r.wallet.id).toBe("aegis_w_trc20_001");
    expect(r.wallet.network).toBe("trc20");
  });

  it("created:false (повтор) — норма, не ошибка", async () => {
    const c = mk([{ method: "POST", match: "/v1/wallets", body: FIX_REGISTER_EXISTS }]);
    const r = await c.registerWallet({ address: "T...", network: "TRC20", label: "W88 Mark" });
    expect(r.created).toBe(false);
    expect(r.wallet.id).toBe("aegis_w_trc20_001");
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

describe("getWallet — нормализация", () => {
  it("ok: баланс строкой, риск ok, без reasons", async () => {
    const c = mk([{ method: "GET", match: "/v1/wallets/", body: FIX_WALLET_OK }]);
    const w = await c.getWallet("aegis_w_trc20_001");
    expect(w.riskLevel).toBe("ok");
    expect(w.balanceUsdEst).toBe("12500.40"); // строка, не число
    expect(typeof w.balanceUsdEst).toBe("string");
    expect(w.balanceUnavailable).toBeNull();
    expect(w.riskReasons).toEqual([]);
  });

  it("warning: reasons как message-строки", async () => {
    const c = mk([{ method: "GET", match: "/v1/wallets/", body: FIX_WALLET_WARNING }]);
    const w = await c.getWallet("aegis_w_erc20_002");
    expect(w.riskLevel).toBe("warning");
    expect(w.riskReasons.map((r) => r.message)).toContain("Unusual outflow velocity in last 24h");
  });

  it("degraded: balance data_unavailable → null (НЕ 0) + причина; syncedAt null", async () => {
    const c = mk([{ method: "GET", match: "/v1/wallets/", body: FIX_WALLET_DEGRADED }]);
    const w = await c.getWallet("aegis_w_erc20_004");
    expect(w.capability).toBe("degraded");
    expect(w.balanceUsdEst).toBeNull();
    expect(w.balanceUnavailable).toMatchObject({ code: "provider_timeout" });
    expect(w.syncedAt).toBeNull();
  });
});

describe("walletToCacheRow", () => {
  it("доступный баланс → пишем balance_usd_est + synced_at", () => {
    const row = walletToCacheRow(normalizeWallet(FIX_WALLET_OK));
    expect(row.risk_level).toBe("ok");
    expect(row.balance_usd_est).toBe("12500.40");
    expect(row.synced_at).toBeTruthy();
  });

  it("data_unavailable → НЕ затираем баланс (нет ключа), но риск обновляем", () => {
    const row = walletToCacheRow(normalizeWallet(FIX_WALLET_DEGRADED));
    expect(row).not.toHaveProperty("balance_usd_est");
    expect(row).not.toHaveProperty("synced_at");
    expect(row.aegis_capability).toBe("degraded");
  });
});

describe("getStats / getTransactions — data_unavailable", () => {
  it("stats ok", async () => {
    const c = mk([{ method: "GET", match: "/stats", body: FIX_STATS_OK }]);
    const s = await c.getStats("id", "2026-07-01", "2026-07-19");
    expect(s.data.sumUsd).toBe("84210.75");
    expect(s.unavailable).toBeNull();
  });

  it("stats data_unavailable → data null + reason", async () => {
    const c = mk([{ method: "GET", match: "/stats", body: FIX_STATS_UNAVAILABLE }]);
    const s = await c.getStats("id", "2020-01-01", "2026-07-19");
    expect(s.data).toBeNull();
    expect(s.unavailable.code).toBe("range_too_large");
  });

  it("transactions пагинация: next_cursor затем null", async () => {
    const c1 = mk([{ method: "GET", match: "/transactions", body: FIX_TX_PAGE }]);
    const p1 = await c1.getTransactions("id", null);
    expect(p1.transactions).toHaveLength(2);
    expect(p1.transactions[0].usdEst).toBe("1000.00");
    expect(p1.nextCursor).toBe("cursor_page2");

    const c2 = mk([{ method: "GET", match: "/transactions", body: FIX_TX_LAST_PAGE }]);
    const p2 = await c2.getTransactions("id", "cursor_page2");
    expect(p2.transactions).toHaveLength(0);
    expect(p2.nextCursor).toBeNull();
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
