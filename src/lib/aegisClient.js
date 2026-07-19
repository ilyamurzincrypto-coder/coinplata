// src/lib/aegisClient.js
// HTTP-клиент к AEGIS /v1. ⚠️ СЕРВЕРНЫЙ модуль: использует секрет AEGIS_API_KEY,
// импортируется ТОЛЬКО из api/aegis/* (и тестов). Браузер сюда не ходит — UI
// дёргает наши api/aegis/* endpoints с JWT сотрудника.
//
// Формы ответов — БИНАРНО по §4b (docs/AEGIS_INTEGRATION_PHASE0.md, заморожен;
// приведены после ревью A–G). Клиент отдаёт наружу НОРМАЛИЗОВАННУЮ форму.
//
// Деньги-инвариант: decimal-поля (usd_est, sum_usd) держим СТРОКАМИ и НИКОГДА
// не пускаем в леджер/проводки/деньги-математику. В Number коэрсим лишь на
// границе отображения/порога расхождения (utils accountsRisk.js).

// --- нормализация сети (G3): касса ХРАНИТ network_id как есть (TRC20/ERC20/BTC);
// в AEGIS ШЛЁТ enum TRON|ETHEREUM|BITCOIN. Один маппер, обе стороны. ---
const KASSA_TO_AEGIS = { trc20: "TRON", tron: "TRON", trx: "TRON", erc20: "ETHEREUM", eth: "ETHEREUM", ethereum: "ETHEREUM", btc: "BITCOIN", bitcoin: "BITCOIN" };
const AEGIS_TO_KASSA = { TRON: "TRC20", ETHEREUM: "ERC20", BITCOIN: "BTC" };

// касса network_id → AEGIS enum. Известное маппим; неизвестное — пробрасываем в UPPER (честно, не глотаем).
export function toAegisNetwork(network) {
  const n = String(network || "").trim();
  return KASSA_TO_AEGIS[n.toLowerCase()] || n.toUpperCase();
}
// AEGIS enum → канальное представление кассы (TRON→TRC20). Неизвестное — как есть.
export function fromAegisNetwork(network) {
  const n = String(network || "").trim().toUpperCase();
  return AEGIS_TO_KASSA[n] || n;
}

// Типизированная ошибка AEGIS — status + code + message (+ retryAfter при 429).
export class AegisError extends Error {
  constructor(message, { status = 0, code = "aegis_error", body = null, retryAfter = null } = {}) {
    super(message);
    this.name = "AegisError";
    this.status = status;
    this.code = code;
    this.body = body;
    if (retryAfter != null) this.retryAfter = retryAfter;
  }
}

// §4b: data_unavailable — МАССИВ секций сверху; секция ∈ массиве → недоступна (значение null, НЕ 0).
function unavailable(raw, section) {
  return Array.isArray(raw?.data_unavailable) && raw.data_unavailable.includes(section);
}

// raw wallet (GET /v1/wallets/:id) → стабильная внутренняя форма (§4b).
export function normalizeWallet(raw) {
  if (!raw) return null;
  const risk = raw.risk || {};
  const balOk = raw.balance && !unavailable(raw, "balance");
  const bal = balOk ? raw.balance : null;
  return {
    id: raw.wallet_id ?? null,
    address: raw.address,
    network: fromAegisNetwork(raw.network), // канальное представление кассы (TRON→TRC20)
    label: raw.label ?? null,
    capability: raw.capability || null, // live | degraded
    dataUnavailable: Array.isArray(raw.data_unavailable) ? raw.data_unavailable : [],
    riskLevel: risk.level ?? null, // ok|warning|critical|null
    riskScore: risk.score ?? null,
    riskReasons: Array.isArray(risk.reasons) ? risk.reasons : [], // [{code,message}]
    riskUpdatedAt: risk.updated_at ?? null,
    // usd_est — СТРОКА | null (null = недоступно, НЕ 0). native/usdt — токен-минор {amount,decimals}.
    balanceUsdEst: bal && bal.usd_est != null ? String(bal.usd_est) : null,
    balanceNative: bal && bal.native ? bal.native : null,
    balanceUsdt: bal && bal.usdt ? bal.usdt : null,
    lastActivityAt: raw.last_activity_at ?? null,
  };
}

// Нормализованный кошелёк → патч кэш-колонок public.accounts.
// balance_usd_est/synced_at обновляем ТОЛЬКО когда баланс доступен (иначе не
// затираем последнее известное значение нулём/пустым). synced_at — касса-side (now()).
export function walletToCacheRow(w) {
  if (!w) return {};
  const row = {
    aegis_capability: w.capability,
    risk_level: w.riskLevel,
    risk_updated_at: w.riskUpdatedAt,
  };
  if (w.balanceUsdEst != null) {
    row.balance_usd_est = w.balanceUsdEst;
    row.synced_at = new Date().toISOString();
  }
  return row;
}

// §4b stats: {in:{count,sum_usd}, out:{count,sum_usd}, by_day:[…], capability, data_unavailable}.
export function normalizeStats(raw) {
  if (raw?.capability === "degraded" || unavailable(raw, "stats")) {
    return { available: false, capability: raw?.capability || "degraded", in: null, out: null, byDay: null };
  }
  const side = (s) => ({ count: s?.count ?? null, sumUsd: s?.sum_usd != null ? String(s.sum_usd) : null });
  return {
    available: true,
    capability: raw?.capability || "live",
    in: side(raw?.in),
    out: side(raw?.out),
    byDay: Array.isArray(raw?.by_day)
      ? raw.by_day.map((d) => ({
          date: d.date,
          inUsd: d.in_usd != null ? String(d.in_usd) : null,
          outUsd: d.out_usd != null ? String(d.out_usd) : null,
          inCount: d.in_count ?? null,
          outCount: d.out_count ?? null,
        }))
      : [],
  };
}

// §4b transactions: {items:[{tx_hash,direction,counterparty,amount:{amount,decimals},counterparty_risk,ts}], cursor, has_more}.
export function normalizeTransactions(raw) {
  if (raw?.capability === "degraded" || unavailable(raw, "transactions")) {
    return { available: false, items: [], cursor: null, hasMore: false };
  }
  return {
    available: true,
    items: (raw?.items || []).map((t) => ({
      txHash: t.tx_hash,
      direction: t.direction,
      counterparty: t.counterparty ?? null,
      // токен-минор {amount:строка, decimals} — НЕ USD (в контракте USD-оценки на транзакцию нет).
      amount: t.amount ? { amount: String(t.amount.amount), decimals: t.amount.decimals } : null,
      counterpartyRisk: t.counterparty_risk
        ? { level: t.counterparty_risk.level ?? null, categories: t.counterparty_risk.categories || [] }
        : null,
      ts: t.ts,
    })),
    cursor: raw?.cursor ?? null,
    hasMore: Boolean(raw?.has_more),
  };
}

// --- фабрика клиента (инъекция config+fetch для тестов) ---
export function createAegisClient({ apiUrl, apiKey, fetchImpl } = {}) {
  const base = (apiUrl || process.env.AEGIS_API_URL || "").replace(/\/$/, "");
  const key = apiKey || process.env.AEGIS_API_KEY || "";
  const doFetch = fetchImpl || globalThis.fetch;

  function configured() {
    return Boolean(base && key);
  }

  async function call(method, path, { body, query } = {}) {
    if (!configured()) throw new AegisError("AEGIS не сконфигурирован (AEGIS_API_URL/KEY)", { code: "not_configured", status: 503 });
    let url = `${base}${path}`;
    if (query) {
      const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null)).toString();
      if (qs) url += `?${qs}`;
    }
    let r;
    try {
      r = await doFetch(url, {
        method,
        headers: {
          // §4b A1: аутентификация — X-API-Key (AEGIS ApiKeyGuard), НЕ Authorization: Bearer.
          "X-API-Key": key,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      throw new AegisError(`AEGIS недоступен: ${e?.message || e}`, { code: "network", status: 502 });
    }
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!r.ok) {
      // §4b: единый конверт ошибок {error:{code,message}}; 429 → Retry-After.
      const code = json?.error?.code || json?.code || `http_${r.status}`;
      const message = json?.error?.message || json?.message || `AEGIS ${r.status}`;
      const opts = { status: r.status, code, body: json };
      if (r.status === 429) {
        const ra = r.headers?.get?.("retry-after");
        if (ra != null) {
          const n = Number(ra);
          opts.retryAfter = Number.isFinite(n) ? n : ra;
        }
      }
      throw new AegisError(message, opts);
    }
    return json;
  }

  return {
    configured,
    // Идемпотентная регистрация. §4b ответ ПЛОСКИЙ {wallet_id,…,created} — риска НЕТ.
    // 200 created:false — норма. 409 → AegisError code=address_unavailable.
    async registerWallet({ address, network, label }) {
      const raw = await call("POST", "/v1/wallets", {
        body: { address, network: toAegisNetwork(network), label },
      });
      return {
        created: Boolean(raw?.created),
        walletId: raw?.wallet_id ?? null,
        address: raw?.address ?? address,
        network: fromAegisNetwork(raw?.network),
        label: raw?.label ?? label ?? null,
      };
    },
    async getWallet(id) {
      return normalizeWallet(await call("GET", `/v1/wallets/${encodeURIComponent(id)}`));
    },
    async getStats(id, from, to) {
      return normalizeStats(await call("GET", `/v1/wallets/${encodeURIComponent(id)}/stats`, { query: { from, to } }));
    },
    async getTransactions(id, { from, to, cursor, limit } = {}) {
      return normalizeTransactions(await call("GET", `/v1/wallets/${encodeURIComponent(id)}/transactions`, { query: { from, to, cursor, limit } }));
    },
  };
}

// Дефолтный инстанс из env (server). В тестах — createAegisClient({...}).
export const aegis = createAegisClient();
