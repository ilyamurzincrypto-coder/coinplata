// src/lib/aegisFixtures.js
// Фикстуры ответов AEGIS /v1 — БИНАРНО по §4b (docs/AEGIS_INTEGRATION_PHASE0.md,
// заморожен). Приведены к контракту после ревью A–G (было: провизорные формы).
// Меняется здесь + в parse-хелперах aegisClient.js; остальной код работает с
// нормализованной формой.
//
// §4b-инварианты форм:
//   • сеть в ответах AEGIS = enum TRON|ETHEREUM|BITCOIN (касса хранит TRC20/… — маппер на границе)
//   • деньги-токены = {amount: строка-минорные, decimals} (native/usdt); USD = строка-оценка (usd_est/sum_usd)
//   • capability ∈ live|degraded; data_unavailable = МАССИВ секций сверху; секция → null (не 0, не объект)
//   • risk = {level, score, reasons:[{code,message}], updated_at}; reason.code ∈ blacklist|destroyed|sanction|ban_pending|risk_factor
//   • POST /v1/wallets ответ ПЛОСКИЙ {wallet_id,address,network,label,created} — риска в нём НЕТ

// --- POST /v1/wallets (регистрация, идемпотентно → 200) ---
export const FIX_REGISTER_CREATED = {
  wallet_id: "aegis_w_trc20_001",
  address: "TMarkExampleAddrTRC20xxxxxxxxxxxxx",
  network: "TRON",
  label: "W88 Mark",
  created: true,
};

// Идемпотентный повтор: 200 + created:false — НОРМА, не ошибка.
export const FIX_REGISTER_EXISTS = { ...FIX_REGISTER_CREATED, created: false };

// 409 — адрес занят другим тенантом. Показать явно.
export const FIX_REGISTER_409 = {
  status: 409,
  body: { error: { code: "address_unavailable", message: "Address already registered to another tenant" } },
};

// --- GET /v1/wallets/:id ---
export const FIX_WALLET_OK = {
  wallet_id: "aegis_w_trc20_001",
  address: "TMarkExampleAddrTRC20xxxxxxxxxxxxx",
  network: "TRON",
  label: "W88 Mark",
  capability: "live",
  data_unavailable: [],
  balance: {
    native: { amount: "1500000000", decimals: 6, symbol: "TRX" },
    usdt: { amount: "12500400000", decimals: 6 },
    usd_est: "12500.40",
  },
  risk: { level: "ok", score: 2, reasons: [], updated_at: "2026-07-19T09:00:00.000Z" },
  last_activity_at: "2026-07-19T08:40:00.000Z",
};

export const FIX_WALLET_WARNING = {
  wallet_id: "aegis_w_erc20_002",
  address: "0xLaraExampleAddrERC20xxxxxxxxxxxxxxxxxxxx",
  network: "ETHEREUM",
  label: "W89 Lara",
  capability: "live",
  data_unavailable: [],
  balance: {
    native: { amount: "320000000000000000", decimals: 18, symbol: "ETH" },
    usdt: { amount: "4820000000", decimals: 6 },
    usd_est: "4820.00",
  },
  risk: {
    level: "warning",
    score: 55,
    reasons: [
      { code: "risk_factor", message: "Interacted with a flagged mixer address" },
      { code: "risk_factor", message: "Unusual outflow velocity in last 24h" },
    ],
    updated_at: "2026-07-19T10:12:00.000Z",
  },
  last_activity_at: "2026-07-19T10:10:00.000Z",
};

export const FIX_WALLET_CRITICAL = {
  wallet_id: "aegis_w_trc20_003",
  address: "TRiskExampleAddrTRC20yyyyyyyyyyyyy",
  network: "TRON",
  label: "W92 USDT",
  capability: "live",
  data_unavailable: [],
  balance: {
    native: { amount: "50000000", decimals: 6, symbol: "TRX" },
    usdt: { amount: "300000000", decimals: 6 },
    usd_est: "300.00",
  },
  risk: {
    level: "critical",
    score: 100,
    reasons: [{ code: "sanction", message: "Direct exposure to a sanctioned entity" }],
    updated_at: "2026-07-19T11:00:00.000Z",
  },
  last_activity_at: "2026-07-19T10:55:00.000Z",
};

// capability:degraded (ETH/BTC пока не индексируются) — balance=null, секции в
// data_unavailable. НЕ 0. risk best-effort (санкц/blacklist сетенезависимы) остаётся.
export const FIX_WALLET_DEGRADED = {
  wallet_id: "aegis_w_erc20_004",
  address: "0xDegradedAddrERC20zzzzzzzzzzzzzzzzzzzz",
  network: "ETHEREUM",
  label: "Hot ERC20",
  capability: "degraded",
  data_unavailable: ["balance", "stats", "transactions"],
  balance: null,
  risk: { level: "ok", score: 0, reasons: [], updated_at: "2026-07-19T08:00:00.000Z" },
  last_activity_at: null,
};

// --- GET /v1/wallets/:id/stats ---
export const FIX_STATS_OK = {
  in: { count: 12, sum_usd: "1500.00" },
  out: { count: 8, sum_usd: "900.00" },
  by_day: [
    { date: "2026-07-18", in_usd: "500.00", out_usd: "100.00", in_count: 3, out_count: 1 },
    { date: "2026-07-19", in_usd: "1000.00", out_usd: "800.00", in_count: 9, out_count: 7 },
  ],
  capability: "live",
  data_unavailable: [],
};

// Деградация (ETH/BTC) — секции null, capability degraded.
export const FIX_STATS_UNAVAILABLE = {
  in: null,
  out: null,
  by_day: null,
  capability: "degraded",
  data_unavailable: ["stats"],
};

// --- GET /v1/wallets/:id/transactions ---
export const FIX_TX_PAGE = {
  items: [
    {
      tx_hash: "0xabc0000000000000000000000000000000000000000000000000000000000001",
      direction: "in",
      counterparty: "TCleanCounterpartyAddrxxxxxxxxxxxx",
      amount: { amount: "1000000000", decimals: 6 },
      counterparty_risk: { level: "ok", categories: [] },
      ts: "2026-07-19T09:01:00.000Z",
    },
    {
      tx_hash: "0xdef0000000000000000000000000000000000000000000000000000000000002",
      direction: "out",
      counterparty: "TRiskCounterpartyAddryyyyyyyyyyyyyy",
      amount: { amount: "250000000", decimals: 6 },
      counterparty_risk: { level: "critical", categories: ["BLACKLIST"] },
      ts: "2026-07-19T09:03:00.000Z",
    },
  ],
  cursor: "cursor_page2",
  has_more: true,
  capability: "live",
  data_unavailable: [],
};

export const FIX_TX_LAST_PAGE = {
  items: [],
  cursor: null,
  has_more: false,
  capability: "live",
  data_unavailable: [],
};

// --- webhook events (тело для api/aegis/webhook.js, Шаг 4) — §4b ---
export const FIX_EVENT_RISK_CHANGED = {
  delivery_id: "dlv_risk_0001",
  event: "risk.changed",
  occurred_at: "2026-07-19T10:12:00.000Z",
  wallet_id: "aegis_w_erc20_002",
  address: "0xLaraExampleAddrERC20xxxxxxxxxxxxxxxxxxxx",
  network: "ETHEREUM",
  risk: {
    level: "warning",
    score: 55,
    reasons: [{ code: "risk_factor", message: "Unusual outflow velocity in last 24h" }],
  },
  prev_level: "ok",
};

export const FIX_EVENT_RISK_CRITICAL = {
  delivery_id: "dlv_risk_0002",
  event: "risk.changed",
  occurred_at: "2026-07-19T11:00:00.000Z",
  wallet_id: "aegis_w_trc20_003",
  address: "TRiskExampleAddrTRC20yyyyyyyyyyyyy",
  network: "TRON",
  risk: {
    level: "critical",
    score: 100,
    reasons: [{ code: "sanction", message: "Direct exposure to a sanctioned entity" }],
  },
  prev_level: "warning",
};

export const FIX_EVENT_RISK_CLEARED = {
  delivery_id: "dlv_risk_0003",
  event: "risk.changed",
  occurred_at: "2026-07-19T12:00:00.000Z",
  wallet_id: "aegis_w_trc20_003",
  address: "TRiskExampleAddrTRC20yyyyyyyyyyyyy",
  network: "TRON",
  risk: { level: "ok", score: 0, reasons: [] },
  prev_level: "critical",
};

export const FIX_EVENT_BALANCE_CHANGED = {
  delivery_id: "dlv_bal_0001",
  event: "balance.changed",
  occurred_at: "2026-07-19T12:30:00.000Z",
  wallet_id: "aegis_w_trc20_001",
  address: "TMarkExampleAddrTRC20xxxxxxxxxxxxx",
  network: "TRON",
  balance: {
    native: { amount: "1500000000", decimals: 6, symbol: "TRX" },
    usdt: { amount: "12777100000", decimals: 6 },
    usd_est: "12777.10",
  },
  delta: { amount: "276700000", decimals: 6, direction: "in" },
};
