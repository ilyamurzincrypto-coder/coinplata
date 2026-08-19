// aegisClient.test.js — клиент AEGIS на фикстурах §4b (приведены после ревью A–G).
import { describe, it, expect } from "vitest";
import {
  createAegisClient,
  AegisError,
  normalizeWallet,
  walletToCacheRow,
  toAegisNetwork,
  fromAegisNetwork,
  normalizeRisk,
  normalizeRiskDetail,
  normalizeAlert,
  normalizeFundsFlow,
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
    expect(toAegisNetwork("BEP20")).toBe("BSC");
    expect(toAegisNetwork("bep20")).toBe("BSC");
    expect(toAegisNetwork("btc")).toBe("BITCOIN");
  });
  it("AEGIS enum → канальное представление кассы", () => {
    expect(fromAegisNetwork("TRON")).toBe("TRC20");
    expect(fromAegisNetwork("ETHEREUM")).toBe("ERC20");
    expect(fromAegisNetwork("BSC")).toBe("BEP20");
    expect(fromAegisNetwork("BITCOIN")).toBe("BTC");
  });
  it("BEP20 круговой маппинг стабилен", () => {
    expect(fromAegisNetwork(toAegisNetwork("BEP20"))).toBe("BEP20");
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
    expect(row.risk_score).toBe(2); // числовой скор в кэш → колонка «риск» в списке
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
    // распределение объёма по риску (для стек-бара + рисковые %)
    expect(s.riskDistribution.risky_share).toBe(30);
    expect(s.riskDistribution.total.low.share).toBe(70);
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
    // новые поля: числовой риск перевода + тип контрагента + score контрагента
    expect(p1.items[0].riskScore).toBe(8);
    expect(p1.items[0].counterpartyType).toBe("exchange");
    expect(p1.items[1].riskScore).toBe(95);
    expect(p1.items[1].counterpartyType).toBe("mixer");
    expect(p1.items[1].counterpartyRisk.score).toBe(95);
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

describe("screenRisk (POST /v1/risk батч)", () => {
  it("маппит risks[] + hop2_proximity, шлёт AEGIS enum", async () => {
    let sentBody = null;
    const c = createAegisClient({ apiUrl: "https://aegis.test", apiKey: "k", fetchImpl: async (_url, opts) => {
      sentBody = JSON.parse(opts.body);
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ risks: [
        { address: "TDirty", score: 100, level: "critical", categories: ["SANCTION"], hop2_proximity: false },
        { address: "TVia", score: 25, level: "warning", categories: [], hop2_proximity: true },
      ] }) };
    }});
    const r = await c.screenRisk({ network: "TRC20", addresses: ["TDirty", "TVia"] });
    expect(sentBody.network).toBe("TRON");
    expect(r[0]).toMatchObject({ address: "TDirty", score: 100, level: "critical", hop2: false });
    expect(r[1]).toMatchObject({ score: 25, hop2: true });
  });
  it("пустой список → без запроса, []", async () => {
    const c = mk([]);
    expect(await c.screenRisk({ network: "TRC20", addresses: [] })).toEqual([]);
  });
});

describe("getRiskDetail (GET /v1/risk/{net}/{addr})", () => {
  it("нормализует breakdown (share_pct null = прямая метка) + флаги", async () => {
    const c = mk([{ method: "GET", match: "/v1/risk/TRON/TVYU", body: {
      score: 100, level: "critical", sanctioned: true, blacklisted: true, headline: "OFAC",
      breakdown: [ { category: "SANCTION", label: "санкции", severity: 100, share_pct: null, direct: true },
                   { category: "gambling", label: "гемблинг", severity: 40, share_pct: 6.1, direct: false } ],
      reasons: ["OFAC SDN"] } }]);
    const d = await c.getRiskDetail("TRC20", "TVYU");
    expect(d).toMatchObject({ score: 100, level: "critical", sanctioned: true, blacklisted: true });
    expect(d.breakdown[0]).toMatchObject({ label: "санкции", severity: 100, sharePct: null, direct: true });
    expect(d.breakdown[1]).toMatchObject({ sharePct: 6.1, direct: false });
    expect(d.reasons).toEqual(["OFAC SDN"]);
  });
});

describe("addContacts (POST /v1/contacts деаноним)", () => {
  it("маппит network→enum, отдаёт {upserted,skipped}", async () => {
    let sent = null;
    const c = createAegisClient({ apiUrl: "https://aegis.test", apiKey: "k", fetchImpl: async (_url, opts) => {
      sent = JSON.parse(opts.body);
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ upserted: 2, skipped: 0 }) };
    }});
    const r = await c.addContacts([
      { network: "TRC20", address: "Taaa", name: "W88", type: "own" },
      { network: "ERC20", address: "0xbbb", name: "Hot", type: "own" },
    ]);
    expect(sent.contacts[0]).toMatchObject({ network: "TRON", address: "Taaa", name: "W88", type: "own" });
    expect(sent.contacts[1].network).toBe("ETHEREUM");
    expect(r).toEqual({ upserted: 2, skipped: 0 });
  });
  it("пустой список → без запроса", async () => {
    const c = mk([]);
    expect(await c.addContacts([])).toEqual({ upserted: 0, skipped: 0 });
  });
});

describe("новые структурные поля /v1/risk (unknown ≠ чисто, hard-факты)", () => {
  it("normalizeRisk: assessment/nested_service/checked_clean/coverage/funds_flow", () => {
    const r = normalizeRisk({
      address: "TX", score: 46, level: "warning", assessment: "preliminary", blacklisted: false,
      nested_service: { name: "OTC Desk X", license: null, source: "salary" },
      checked_clean: ["sanctions", "blacklist", "mixer"],
      coverage: { typed_pct: 42, unknown_pct: 58 },
      funds_flow: { source: [{ category: "mixer", label: "миксер", share_pct: 12, usdt: 1000, risk_pct: 80 }], destination: [] },
    });
    expect(r).toMatchObject({ assessment: "preliminary", checkedClean: ["sanctions", "blacklist", "mixer"] });
    expect(r.nestedService).toMatchObject({ name: "OTC Desk X", source: "salary" });
    expect(r.coverage).toEqual({ typedPct: 42, unknownPct: 58 });
    expect(r.fundsFlow.source[0]).toMatchObject({ category: "mixer", sharePct: 12, riskPct: 80 });
  });
  it("normalizeRisk: поля отсутствуют → null/[] (не падаем, не «чисто»)", () => {
    const r = normalizeRisk({ address: "TX", score: 0, level: "ok" });
    expect(r).toMatchObject({ assessment: null, nestedService: null, checkedClean: [], fundsFlow: null, coverage: null });
  });
  it("normalizeFundsFlow: source/destination слайсы, risk_pct дефолт 0", () => {
    const ff = normalizeFundsFlow({ source: [{ category: "exchange", share_pct: 90 }], destination: [{ category: "scam", share_pct: 5, risk_pct: 100 }] });
    expect(ff.source[0]).toMatchObject({ category: "exchange", sharePct: 90, riskPct: 0 });
    expect(ff.destination[0]).toMatchObject({ riskPct: 100 });
    expect(normalizeFundsFlow(null)).toBe(null);
  });
  it("normalizeRiskDetail: funds_flow{source,destination} + coverage", () => {
    const d = normalizeRiskDetail({
      score: 70, level: "warning",
      funds_flow: { source: [{ category: "mixer", label: "миксер", share_pct: 30, usdt: 5000, risk_pct: 100 }], destination: [] },
      coverage: { typed_pct: 55, unknown_pct: 45 },
      breakdown: [],
    });
    expect(d.fundsFlow.source[0]).toMatchObject({ label: "миксер", sharePct: 30, usdt: 5000, riskPct: 100 });
    expect(d.coverage).toEqual({ typedPct: 55, unknownPct: 45 });
  });
  it("normalizeRisk: verdict (готовый клиентский вердикт)", () => {
    const r = normalizeRisk({
      address: "TX", score: 71,
      verdict: { emoji: "🔴", level_text: "ВЫСОКИЙ РИСК", score: 71, action: "❌ отказ", reasons: ["a", { text: "b", detail: "пруф b" }], sources: [{ emoji: "❓", label: "Неизвестно", pct: 76, bar: "▓░" }], clean_note: "✅ нет" },
    });
    expect(r.verdict).toMatchObject({ emoji: "🔴", levelText: "ВЫСОКИЙ РИСК", score: 71, action: "❌ отказ", cleanNote: "✅ нет" });
    // reasons нормализуются в {text, detail}; терпим строку (detail=null) и объект
    expect(r.verdict.reasons).toEqual([{ text: "a", detail: null, address: null, tx: null, basis: "signal" }, { text: "b", detail: "пруф b", address: null, tx: null, basis: "signal" }]);
    expect(r.verdict.sources[0]).toMatchObject({ label: "Неизвестно", pct: 76, bar: "▓░" });
  });
  it("normalizeRisk: verdict отсутствует → null", () => {
    expect(normalizeRisk({ address: "TX", score: 0 }).verdict).toBe(null);
  });
  it("normalizeRisk: risk_by_category (двунаправленно, out_pct)", () => {
    const r = normalizeRisk({ address: "TX", risk_by_category: [{ emoji: "🎰", label: "Гемблинг", pct: 0, bar: "░", out_pct: 12, out_bar: "▓" }] });
    expect(r.riskByCategory[0]).toMatchObject({ emoji: "🎰", label: "Гемблинг", pct: 0, bar: "░", outPct: 12, outBar: "▓" });
  });
  it("normalizeRisk: risk_by_category из verdict-фолбэка + outPct=null когда нет", () => {
    const r = normalizeRisk({ address: "TX", verdict: { risk_by_category: [{ emoji: "x", label: "y", pct: 1, bar: "z" }] } });
    expect(r.riskByCategory[0]).toMatchObject({ label: "y", pct: 1, outPct: null });
  });
  it("normalizeAlert: RISK_UPGRADE prev/new/level", () => {
    const a = normalizeAlert({ alert_id: "up-1", type: "RISK_UPGRADE", address: "TX", prev_score: 10, new_score: 46, level: "warning", category: "mixer" });
    expect(a).toMatchObject({ type: "RISK_UPGRADE", address: "TX", prevScore: 10, newScore: 46, level: "warning", category: "mixer" });
  });
});
