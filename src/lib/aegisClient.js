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

// --- нормализация сети (G3): касса ХРАНИТ network_id как есть (TRC20/ERC20/BEP20/BTC);
// в AEGIS ШЛЁТ enum TRON|ETHEREUM|BSC|BITCOIN. Один маппер, обе стороны. ---
const KASSA_TO_AEGIS = { trc20: "TRON", tron: "TRON", trx: "TRON", erc20: "ETHEREUM", eth: "ETHEREUM", ethereum: "ETHEREUM", bep20: "BSC", bsc: "BSC", bnb: "BSC", btc: "BITCOIN", bitcoin: "BITCOIN" };
const AEGIS_TO_KASSA = { TRON: "TRC20", ETHEREUM: "ERC20", BSC: "BEP20", BITCOIN: "BTC" };

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
    // Форвард-совместимо (entity attribution, AEGIS дошлёт): состав экспозиции
    // кошелька по типам сущностей + топ именованных сущностей. null пока полей нет.
    exposure: raw.exposure || null, // { inbound:[{category,entity_name?,share,volume_usd}], outbound:[...], unknown_share, assessed_share }
    topEntities: Array.isArray(raw.top_entities) ? raw.top_entities : null, // [{entity_name,category,direction,volume_usd,tx_count,risk}]
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
    risk_score: w.riskScore ?? null, // 0-100 (кэш; для колонки «риск» в списке)
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
    // Распределение объёма по риску за период (для стек-бара + «рисковые N%»).
    // { inbound, total:{high/medium/low:{volume,share}}, risky_share }; null на EVM (degraded).
    riskDistribution: raw?.risk_distribution ?? null,
    // Разбор сущностей (AEGIS положил сюда, не в getWallet): состав экспозиции по
    // категориям + топ именованных сущностей. null пока нет данных.
    exposure: raw?.exposure ?? null, // { inbound:[{category,entity_name?,share,volume_usd}], outbound:[…], unknown_share, assessed_share }
    topEntities: Array.isArray(raw?.top_entities) ? raw.top_entities : null, // [{entity_name,category,direction,volume_usd,tx_count,risk}]
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
      // риск перевода 0-100 (пороги ok≤25 / warning 25-80 / critical>80); опционально.
      riskScore: t.risk_score ?? null,
      // тип контрагента: exchange/p2p_merchant/mixer/private/internal/bridge/contract/unknown.
      counterpartyType: t.counterparty_type ?? null,
      counterpartyRisk: t.counterparty_risk
        ? { level: t.counterparty_risk.level ?? null, score: t.counterparty_risk.score ?? null, categories: t.counterparty_risk.categories || [] }
        : null,
      // Именованная сущность контрагента (форвард-совместимо; AEGIS ещё дошлёт —
      // см. спеку entity attribution). null-безопасно, пока полей нет.
      counterpartyEntity: t.counterparty_entity
        ? {
            name: t.counterparty_entity.name ?? null,
            category: t.counterparty_entity.category ?? null,
            kyc: t.counterparty_entity.kyc ?? null,
            sanctioned: t.counterparty_entity.sanctioned === true,
            jurisdiction: t.counterparty_entity.jurisdiction ?? null,
            confidence: t.counterparty_entity.confidence ?? null,
          }
        : null,
      ts: t.ts,
    })),
    cursor: raw?.cursor ?? null,
    hasMore: Boolean(raw?.has_more),
  };
}

// GET /v1/alerts item → внутренняя форма. HOP2_RISK: грязь в 2 хопах через нашего
// контрагента (via_counterparty). network держим как есть (raw enum о цепочке грязного
// адреса — это НЕ network_id нашего счёта). Денег тут нет.
export function normalizeAlert(raw) {
  if (!raw) return null;
  return {
    alertId: raw.alert_id ?? null,
    type: raw.type ?? null,
    network: raw.network ?? null,
    riskAddress: raw.risk_address ?? null,
    category: raw.category ?? null,
    viaCounterparty: raw.via_counterparty ?? null,
    officeWalletId: raw.office_wallet_id ?? null,
    officeLabel: raw.office_label ?? null,
    note: raw.note ?? null,
    status: raw.status ?? null,
    createdAt: raw.created_at ?? null,
  };
}

// POST /v1/risk item → внутренняя форма (батч-скрининг адресов, дёшево, DB-only).
export function normalizeRisk(raw) {
  if (!raw) return null;
  return {
    address: raw.address ?? null,
    score: raw.score ?? null, // 0..100 | null
    level: raw.level ?? null, // ok|warning|critical
    categories: Array.isArray(raw.categories) ? raw.categories : [],
    hop2: raw.hop2_proximity === true, // контрагент сам в 1 шаге от санкц/ЧС
    assessed: raw.assessed === true, // есть КОНКРЕТНЫЙ сигнал (иначе «нет данных», не «чисто»)
    behavioralType: raw.behavioral_type ?? null, // поведенческий тип (для подписи риска)
    // Факторы риска с % (отсорт по pct) — для expandable-цитаты в уведомлении.
    breakdown: Array.isArray(raw.breakdown)
      ? raw.breakdown.map((b) => ({ label: b.label ?? null, pct: b.pct ?? null, kind: b.kind ?? null }))
      : [],
  };
}

// GET /v1/risk/{net}/{addr} → детальная раскладка (дороже — полный screen).
export function normalizeRiskDetail(raw) {
  if (!raw) return null;
  return {
    score: raw.score ?? null,
    level: raw.level ?? null,
    sanctioned: raw.sanctioned === true,
    blacklisted: raw.blacklisted === true,
    headline: raw.headline ?? null,
    breakdown: Array.isArray(raw.breakdown)
      ? raw.breakdown.map((b) => ({
          category: b.category ?? null,
          label: b.label ?? b.category ?? null, // рус-метка
          severity: b.severity ?? null, // 0..100
          sharePct: b.share_pct ?? null, // null = прямая метка адреса
          direct: b.direct === true,
        }))
      : [],
    reasons: Array.isArray(raw.reasons) ? raw.reasons : [],
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
    // Тенант-уровневые находки риска (HOP2_RISK и пр.). Тот же X-API-Key.
    async getAlerts({ limit } = {}) {
      const raw = await call("GET", "/v1/alerts", { query: { limit } });
      const arr = Array.isArray(raw?.alerts) ? raw.alerts : [];
      return { alerts: arr.map(normalizeAlert).filter(Boolean) };
    },
    // Батч-скрининг риска адресов (≤200). Дёшево — можно на каждое уведомление.
    async screenRisk({ network, addresses } = {}) {
      const list = (addresses || []).filter(Boolean).slice(0, 200);
      if (!list.length) return [];
      const raw = await call("POST", "/v1/risk", { body: { network: toAegisNetwork(network), addresses: list } });
      const risks = Array.isArray(raw?.risks) ? raw.risks : [];
      return risks.map(normalizeRisk).filter(Boolean);
    },
    // Детальная раскладка риска по одному адресу.
    async getRiskDetail(network, address) {
      const raw = await call("GET", `/v1/risk/${encodeURIComponent(toAegisNetwork(network))}/${encodeURIComponent(address)}`);
      return normalizeRiskDetail(raw);
    },
    // Залить контакты (деаноним) — адрес↔имя. network → enum. Батч ≤500. Идемпотентно
    // на стороне AEGIS (дедуп по network+address). Возвращает {upserted, skipped}.
    async addContacts(contacts) {
      const list = (contacts || []).filter((c) => c && c.address && c.network).slice(0, 500);
      if (!list.length) return { upserted: 0, skipped: 0 };
      const raw = await call("POST", "/v1/contacts", {
        body: {
          contacts: list.map((c) => ({
            network: toAegisNetwork(c.network),
            address: c.address,
            name: c.name,
            type: c.type,
            ...(c.telegram ? { telegram: c.telegram } : {}),
          })),
        },
      });
      return { upserted: raw?.upserted ?? 0, skipped: raw?.skipped ?? 0 };
    },
  };
}

// Дефолтный инстанс из env (server). В тестах — createAegisClient({...}).
export const aegis = createAegisClient();
