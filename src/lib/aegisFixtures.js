// src/lib/aegisFixtures.js
// ⚠️ ПРОВИЗОРНЫЕ формы ответов AEGIS /v1 (§4b). Реальный контракт ещё
// допиливается на тестовом tenant — эти фикстуры собраны ПО ОПИСАНИЮ шага 4
// части B и подлежат сверке с настоящим §4b, когда /v1 поднимут. Меняется здесь
// + в parse-хелперах aegisClient.js; остальной код работает с нормализованной
// формой и не зависит от точной проволоки.
//
// Инварианты, которые НЕ провизорны (зафиксированы в решениях):
//   • risk level ∈ ok | warning | critical
//   • decimal-поля (usd_est, sum_usd) — СТРОКИ, в деньги-математику не ходят
//   • data_unavailable → секция null (не 0), с reason {code, message}
//   • capability ∈ full | degraded | ...

// --- registerWallet ---
export const FIX_REGISTER_CREATED = {
  created: true,
  wallet: {
    id: "aegis_w_trc20_001",
    address: "TMarkExampleAddrTRC20xxxxxxxxxxxxx",
    network: "trc20",
    label: "W88 Mark",
    capability: "full",
    risk_level: "ok",
    risk_updated_at: "2026-07-19T09:00:00.000Z",
  },
};

// Идемпотентный повтор: 200 + created:false — это НОРМА, не ошибка.
export const FIX_REGISTER_EXISTS = {
  created: false,
  wallet: { ...FIX_REGISTER_CREATED.wallet },
};

// 409 — адрес занят другим tenant/кошельком. Показать явно.
export const FIX_REGISTER_409 = {
  status: 409,
  body: { error: { code: "address_unavailable", message: "Address already registered to another wallet" } },
};

// --- getWallet ---
export const FIX_WALLET_OK = {
  id: "aegis_w_trc20_001",
  address: "TMarkExampleAddrTRC20xxxxxxxxxxxxx",
  network: "trc20",
  label: "W88 Mark",
  capability: "full",
  risk: { level: "ok", reasons: [], updated_at: "2026-07-19T09:00:00.000Z" },
  balance: { usd_est: "12500.40", synced_at: "2026-07-19T09:05:00.000Z" },
};

export const FIX_WALLET_WARNING = {
  id: "aegis_w_erc20_002",
  address: "0xLaraExampleAddrERC20xxxxxxxxxxxxxxxxxxxx",
  network: "erc20",
  label: "W89 Lara",
  capability: "full",
  risk: {
    level: "warning",
    reasons: [
      { code: "counterparty_exposure", message: "Interacted with a flagged mixer address" },
      { code: "velocity", message: "Unusual outflow velocity in last 24h" },
    ],
    updated_at: "2026-07-19T10:12:00.000Z",
  },
  balance: { usd_est: "4820.00", synced_at: "2026-07-19T10:12:00.000Z" },
};

export const FIX_WALLET_CRITICAL = {
  id: "aegis_w_trc20_003",
  address: "TRiskExampleAddrTRC20yyyyyyyyyyyyy",
  network: "trc20",
  label: "W92 USDT",
  capability: "full",
  risk: {
    level: "critical",
    reasons: [{ code: "sanctions_match", message: "Direct exposure to a sanctioned entity" }],
    updated_at: "2026-07-19T11:00:00.000Z",
  },
  balance: { usd_est: "300.00", synced_at: "2026-07-19T11:00:00.000Z" },
};

// capability: degraded + баланс недоступен (проблема сети/провайдера, НЕ 0).
export const FIX_WALLET_DEGRADED = {
  id: "aegis_w_erc20_004",
  address: "0xDegradedAddrERC20zzzzzzzzzzzzzzzzzzzz",
  network: "erc20",
  label: "Hot ERC20",
  capability: "degraded",
  risk: { level: "ok", reasons: [], updated_at: "2026-07-19T08:00:00.000Z" },
  balance: { data_unavailable: { code: "provider_timeout", message: "Balance provider unreachable" } },
};

// --- getStats ---
export const FIX_STATS_OK = {
  from: "2026-07-01",
  to: "2026-07-19",
  sum_usd: "84210.75",
  tx_count: 37,
};

export const FIX_STATS_UNAVAILABLE = {
  data_unavailable: { code: "range_too_large", message: "Requested range exceeds retention window" },
};

// --- getTransactions ---
export const FIX_TX_PAGE = {
  transactions: [
    { hash: "0xabc...", direction: "in", usd_est: "1000.00", at: "2026-07-19T09:01:00.000Z" },
    { hash: "0xdef...", direction: "out", usd_est: "250.00", at: "2026-07-19T09:03:00.000Z" },
  ],
  next_cursor: "cursor_page2",
};

export const FIX_TX_LAST_PAGE = { transactions: [], next_cursor: null };

// --- webhook events (тело для api/aegis/webhook.js) ---
export const FIX_EVENT_RISK_CHANGED = {
  event: "risk.changed",
  delivery_id: "dlv_risk_0001",
  wallet_id: "aegis_w_erc20_002",
  prev_level: "ok",
  level: "warning",
  reasons: [{ code: "velocity", message: "Unusual outflow velocity in last 24h" }],
  risk_updated_at: "2026-07-19T10:12:00.000Z",
};

export const FIX_EVENT_RISK_CRITICAL = {
  event: "risk.changed",
  delivery_id: "dlv_risk_0002",
  wallet_id: "aegis_w_trc20_003",
  prev_level: "warning",
  level: "critical",
  reasons: [{ code: "sanctions_match", message: "Direct exposure to a sanctioned entity" }],
  risk_updated_at: "2026-07-19T11:00:00.000Z",
};

export const FIX_EVENT_RISK_CLEARED = {
  event: "risk.changed",
  delivery_id: "dlv_risk_0003",
  wallet_id: "aegis_w_trc20_003",
  prev_level: "critical",
  level: "ok",
  reasons: [],
  risk_updated_at: "2026-07-19T12:00:00.000Z",
};

export const FIX_EVENT_BALANCE_CHANGED = {
  event: "balance.changed",
  delivery_id: "dlv_bal_0001",
  wallet_id: "aegis_w_trc20_001",
  balance: { usd_est: "12777.10", synced_at: "2026-07-19T12:30:00.000Z" },
};
