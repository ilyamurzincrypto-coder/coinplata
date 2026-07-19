// src/lib/aegisClient.js
// HTTP-клиент к AEGIS /v1. ⚠️ СЕРВЕРНЫЙ модуль: использует секрет AEGIS_API_KEY,
// импортируется ТОЛЬКО из api/aegis/* (и тестов). Браузер сюда не ходит — UI
// дёргает наши api/aegis/* endpoints с JWT сотрудника.
//
// Формы ответов — провизорные (§4b, см. aegisFixtures.js). Клиент отдаёт наружу
// НОРМАЛИЗОВАННУЮ форму; когда /v1 поднимут — правится только парсинг здесь.
//
// Деньги-инвариант: decimal-поля (usd_est, sum_usd) держим СТРОКАМИ и НИКОГДА
// не пускаем в леджер/проводки/деньги-математику. В Number коэрсим лишь на
// границе отображения/порога расхождения (utils accountsRisk.js).

// --- нормализация сети (касса хранит 'TRC20'/'ERC20'; AEGIS ждёт lowercase) ---
export function toAegisNetwork(network) {
  return String(network || "").trim().toLowerCase(); // 'TRC20' → 'trc20'
}
export function fromAegisNetwork(network) {
  return String(network || "").trim().toUpperCase(); // 'trc20' → 'TRC20'
}

// Типизированная ошибка AEGIS — status + code + message (для UI).
export class AegisError extends Error {
  constructor(message, { status = 0, code = "aegis_error", body = null } = {}) {
    super(message);
    this.name = "AegisError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

// Секция «нет данных» → null + причина (НЕ 0). Иначе значение.
function readSection(section, pick) {
  if (!section) return { value: null, unavailable: null };
  if (section.data_unavailable) {
    const r = section.data_unavailable;
    return { value: null, unavailable: { code: r.code || "data_unavailable", message: r.message || "Нет данных" } };
  }
  return { value: pick(section), unavailable: null };
}

// raw wallet (getWallet / register.wallet) → стабильная внутренняя форма.
export function normalizeWallet(raw) {
  if (!raw) return null;
  const risk = raw.risk || {};
  const bal = readSection(raw.balance, (b) => (b.usd_est != null ? String(b.usd_est) : null));
  return {
    id: raw.id,
    address: raw.address,
    network: toAegisNetwork(raw.network),
    label: raw.label || null,
    capability: raw.capability || null, // 'full' | 'degraded' | ...
    riskLevel: raw.risk_level || risk.level || null, // ok|warning|critical|null
    riskReasons: Array.isArray(risk.reasons) ? risk.reasons : [], // [{code,message}]
    riskUpdatedAt: risk.updated_at || raw.risk_updated_at || null,
    balanceUsdEst: bal.value, // строка | null (null = data_unavailable, НЕ 0)
    balanceUnavailable: bal.unavailable, // {code,message} | null
    syncedAt: raw.balance && !raw.balance.data_unavailable ? raw.balance.synced_at || null : null,
  };
}

// Нормализованный кошелёк → патч кэш-колонок public.accounts.
// balance_usd_est/synced_at обновляем ТОЛЬКО когда баланс доступен (иначе не
// затираем последнее известное значение нулём/пустым).
export function walletToCacheRow(w) {
  if (!w) return {};
  const row = {
    aegis_capability: w.capability,
    risk_level: w.riskLevel,
    risk_updated_at: w.riskUpdatedAt,
  };
  if (w.balanceUnavailable == null && w.balanceUsdEst != null) {
    row.balance_usd_est = w.balanceUsdEst;
    row.synced_at = w.syncedAt || new Date().toISOString();
  }
  return row;
}

export function normalizeStats(raw) {
  const s = readSection(raw, (x) => ({ sumUsd: x.sum_usd != null ? String(x.sum_usd) : null, txCount: x.tx_count ?? null, from: x.from, to: x.to }));
  return s.unavailable ? { data: null, unavailable: s.unavailable } : { data: s.value, unavailable: null };
}

export function normalizeTransactions(raw) {
  if (raw && raw.data_unavailable) {
    return { transactions: null, nextCursor: null, unavailable: { code: raw.data_unavailable.code, message: raw.data_unavailable.message } };
  }
  return {
    transactions: (raw?.transactions || []).map((t) => ({
      hash: t.hash,
      direction: t.direction,
      usdEst: t.usd_est != null ? String(t.usd_est) : null,
      at: t.at,
    })),
    nextCursor: raw?.next_cursor ?? null,
    unavailable: null,
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
          authorization: `Bearer ${key}`,
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
      const code = json?.error?.code || json?.code || `http_${r.status}`;
      const message = json?.error?.message || json?.message || `AEGIS ${r.status}`;
      throw new AegisError(message, { status: r.status, code, body: json });
    }
    return json;
  }

  return {
    configured,
    // Идемпотентная регистрация. 200 created:false — норма. 409 → AegisError code=address_unavailable.
    async registerWallet({ address, network, label }) {
      const raw = await call("POST", "/v1/wallets", {
        body: { address, network: toAegisNetwork(network), label },
      });
      return { created: Boolean(raw?.created), wallet: normalizeWallet(raw?.wallet || raw) };
    },
    async getWallet(id) {
      return normalizeWallet(await call("GET", `/v1/wallets/${encodeURIComponent(id)}`));
    },
    async getStats(id, from, to) {
      return normalizeStats(await call("GET", `/v1/wallets/${encodeURIComponent(id)}/stats`, { query: { from, to } }));
    },
    async getTransactions(id, cursor) {
      return normalizeTransactions(await call("GET", `/v1/wallets/${encodeURIComponent(id)}/transactions`, { query: { cursor } }));
    },
  };
}

// Дефолтный инстанс из env (server). В тестах — createAegisClient({...}).
export const aegis = createAegisClient();
