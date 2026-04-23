// src/store/data.js
// Моки данных: офисы, валюты, транзакции, контрагенты, пользователи.

// Офисы несут operational timezone + workingDays (ISO 1=Mon..7=Sun) + workingHours,
// а также свои финансовые настройки (minFeeUsd / feePercent) — комиссии теперь
// per-office, не глобальные. См. ExchangeForm: fee считается от office.minFeeUsd.
const DEFAULT_OFFICE_OPS = {
  timezone: "Europe/Istanbul",
  workingDays: [1, 2, 3, 4, 5, 6], // Mon–Sat
  workingHours: { start: "09:00", end: "21:00" },
  minFeeUsd: 10,     // минимальная комиссия сделки в USD
  feePercent: 0,     // опциональный процент от оборота (в будущем — поверх min fee)
};

export const OFFICES = [
  { id: "mark",  name: "Mark Antalya", city: "Antalya",  status: "active", active: true, ...DEFAULT_OFFICE_OPS },
  { id: "terra", name: "Terra City",   city: "Antalya",  status: "active", active: true, ...DEFAULT_OFFICE_OPS },
  { id: "ist",   name: "Istanbul",     city: "Istanbul", status: "active", active: true, ...DEFAULT_OFFICE_OPS },
];

export { DEFAULT_OFFICE_OPS };

export const CURRENCIES = ["USDT", "USD", "EUR", "TRY", "GBP"];

// Currency dictionary — структурированные метаданные каждой валюты.
// Существующий массив CURRENCIES (коды) оставлен для обратной совместимости.
export const CURRENCIES_DICT = [
  { code: "USD", type: "fiat", symbol: "$", name: "US Dollar", decimals: 2 },
  { code: "EUR", type: "fiat", symbol: "€", name: "Euro", decimals: 2 },
  { code: "TRY", type: "fiat", symbol: "₺", name: "Turkish Lira", decimals: 2 },
  { code: "GBP", type: "fiat", symbol: "£", name: "British Pound", decimals: 2 },
  { code: "CHF", type: "fiat", symbol: "CHF", name: "Swiss Franc", decimals: 2 },
  { code: "RUB", type: "fiat", symbol: "₽", name: "Russian Ruble", decimals: 2 },
  { code: "USDT", type: "crypto", symbol: "₮", name: "Tether USD", decimals: 2 },
];

// Хелперы
export const currencyByCode = (code) => CURRENCIES_DICT.find((c) => c.code === code);
export const isCrypto = (code) => currencyByCode(code)?.type === "crypto";
export const isFiat = (code) => currencyByCode(code)?.type === "fiat";

// Channel kinds — способ передачи средств. Отдельно от типа валюты.
// fiat: cash | bank | sepa | swift
// crypto: всегда "network" (сама сеть в .network)
export const CHANNEL_KINDS = [
  { id: "cash", label: "Cash", forCurrencyType: "fiat" },
  { id: "bank", label: "Bank", forCurrencyType: "fiat" },
  { id: "sepa", label: "SEPA", forCurrencyType: "fiat" },
  { id: "swift", label: "SWIFT", forCurrencyType: "fiat" },
  { id: "network", label: "Network", forCurrencyType: "crypto" },
];

export const NETWORKS = ["TRC20", "ERC20", "BEP20"];

// Channel seed — способы передачи для каждой валюты.
// Поле isDefaultForCurrency отмечает канал по умолчанию для currency —
// используется когда нужно выбрать канал автоматически (напр. для рендера в RatesBar).
export const SEED_CHANNELS = [
  // USD
  { id: "ch_usd_cash", currencyCode: "USD", kind: "cash", isDefaultForCurrency: true },
  { id: "ch_usd_bank", currencyCode: "USD", kind: "bank", isDefaultForCurrency: false },
  { id: "ch_usd_swift", currencyCode: "USD", kind: "swift", isDefaultForCurrency: false },
  // EUR
  { id: "ch_eur_cash", currencyCode: "EUR", kind: "cash", isDefaultForCurrency: false },
  { id: "ch_eur_bank", currencyCode: "EUR", kind: "bank", isDefaultForCurrency: true },
  { id: "ch_eur_sepa", currencyCode: "EUR", kind: "sepa", isDefaultForCurrency: false },
  // TRY
  { id: "ch_try_cash", currencyCode: "TRY", kind: "cash", isDefaultForCurrency: true },
  { id: "ch_try_bank", currencyCode: "TRY", kind: "bank", isDefaultForCurrency: false },
  // GBP
  { id: "ch_gbp_bank", currencyCode: "GBP", kind: "bank", isDefaultForCurrency: true },
  // CHF
  { id: "ch_chf_bank", currencyCode: "CHF", kind: "bank", isDefaultForCurrency: true },
  { id: "ch_chf_cash", currencyCode: "CHF", kind: "cash", isDefaultForCurrency: false },
  // RUB
  { id: "ch_rub_bank", currencyCode: "RUB", kind: "bank", isDefaultForCurrency: true },
  { id: "ch_rub_cash", currencyCode: "RUB", kind: "cash", isDefaultForCurrency: false },
  // USDT (crypto → network)
  { id: "ch_usdt_trc20", currencyCode: "USDT", kind: "network", network: "TRC20", gasFee: 1.0, isDefaultForCurrency: true },
  { id: "ch_usdt_erc20", currencyCode: "USDT", kind: "network", network: "ERC20", gasFee: 15.0, isDefaultForCurrency: false },
  { id: "ch_usdt_bep20", currencyCode: "USDT", kind: "network", network: "BEP20", gasFee: 0.5, isDefaultForCurrency: false },
];

export const TYPES = ["All", "IN", "OUT", "EXCHANGE"];

// Баланс содержит: amount (сегодня), prevAmount (вчера), change (% изменение)
// change сохранено для обратной совместимости; компоненты могут использовать prevAmount для абсолютной дельты.
// ⚠️ DEPRECATED: этот объект больше не используется в UI. Все балансы теперь считаются
// через useAccounts().balanceOf() из movements. Оставлен до полной очистки для возможных
// внешних ссылок. Можно безопасно удалить в следующем рефакторинге.
export const BALANCES_BY_OFFICE = {
  mark: {
    USD: { amount: 48250, prevAmount: 47678, change: 1.2 },
    USDT: { amount: 127430, prevAmount: 127941, change: -0.4 },
    EUR: { amount: 19800, prevAmount: 19741, change: 0.3 },
    TRY: { amount: 1842500, prevAmount: 1792314, change: 2.8 },
    GBP: { amount: 8400, prevAmount: 8392, change: 0.1 },
  },
  terra: {
    USD: { amount: 22100, prevAmount: 21968, change: 0.6 },
    USDT: { amount: 64800, prevAmount: 64094, change: 1.1 },
    EUR: { amount: 8450, prevAmount: 8467, change: -0.2 },
    TRY: { amount: 920300, prevAmount: 907587, change: 1.4 },
    GBP: { amount: 3100, prevAmount: 3100, change: 0.0 },
  },
  ist: {
    USD: { amount: 91500, prevAmount: 91775, change: -0.3 },
    USDT: { amount: 204600, prevAmount: 200391, change: 2.1 },
    EUR: { amount: 37200, prevAmount: 36905, change: 0.8 },
    TRY: { amount: 3120000, prevAmount: 3023255, change: 3.2 },
    GBP: { amount: 15800, prevAmount: 15737, change: 0.4 },
  },
};

// Транзакция теперь поддерживает массив outputs (multi-output).
// Для обратной совместимости остались plain-поля curOut/amtOut — они копируются из outputs[0].
export const SEED_TX = [
  {
    id: 1, time: "14:32", date: "Apr 20", officeId: "mark", type: "EXCHANGE",
    curIn: "USDT", amtIn: 5000,
    outputs: [{ currency: "TRY", amount: 194500, rate: 38.9 }],
    curOut: "TRY", amtOut: 194500, rate: 38.9,
    fee: 25, profit: 62.4,
    manager: "A. Yilmaz", managerId: "u_ay",
    counterparty: "CryptoHouse", referral: false,
  },
  {
    id: 2, time: "14:05", date: "Apr 20", officeId: "mark", type: "EXCHANGE",
    curIn: "USD", amtIn: 1200,
    outputs: [{ currency: "TRY", amount: 46680, rate: 38.9 }],
    curOut: "TRY", amtOut: 46680, rate: 38.9,
    fee: 12, profit: 28.0,
    manager: "A. Yilmaz", managerId: "u_ay",
    counterparty: "", referral: true,
  },
  {
    id: 3, time: "13:41", date: "Apr 20", officeId: "terra", type: "EXCHANGE",
    curIn: "EUR", amtIn: 800,
    outputs: [{ currency: "USDT", amount: 870, rate: 1.0875 }],
    curOut: "USDT", amtOut: 870, rate: 1.0875,
    fee: 10, profit: -3.5,
    manager: "S. Kaya", managerId: "u_sk",
    counterparty: "Murat Y.", referral: false,
  },
  {
    id: 4, time: "12:58", date: "Apr 20", officeId: "ist", type: "EXCHANGE",
    curIn: "USDT", amtIn: 10000,
    outputs: [{ currency: "USD", amount: 9985, rate: 0.9985 }],
    curOut: "USD", amtOut: 9985, rate: 0.9985,
    fee: 50, profit: 35.0,
    manager: "M. Demir", managerId: "u_md",
    counterparty: "Boris L.", referral: true,
  },
  {
    id: 5, time: "11:22", date: "Apr 20", officeId: "ist", type: "EXCHANGE",
    curIn: "TRY", amtIn: 120000,
    outputs: [{ currency: "USDT", amount: 3080, rate: 0.02567 }],
    curOut: "USDT", amtOut: 3080, rate: 0.02567,
    fee: 15, profit: 18.2,
    manager: "M. Demir", managerId: "u_md",
    counterparty: "", referral: false,
  },
  {
    id: 6, time: "10:48", date: "Apr 20", officeId: "mark", type: "IN",
    curIn: "USD", amtIn: 3500,
    outputs: [{ currency: "USD", amount: 3500, rate: 1 }],
    curOut: "USD", amtOut: 3500, rate: 1,
    fee: 0, profit: 0,
    manager: "A. Yilmaz", managerId: "u_ay",
    counterparty: "Office deposit", referral: false,
  },
  {
    id: 7, time: "10:12", date: "Apr 20", officeId: "terra", type: "EXCHANGE",
    curIn: "USDT", amtIn: 2200,
    outputs: [{ currency: "TRY", amount: 85580, rate: 38.9 }],
    curOut: "TRY", amtOut: 85580, rate: 38.9,
    fee: 11, profit: 14.8,
    manager: "S. Kaya", managerId: "u_sk",
    counterparty: "CryptoHouse", referral: false,
  },
];

// Контрагенты: nickname, name, telegram + tag (VIP | Regular | New | Risky) + note.
// tag пустой = эквивалент "Regular" в UI, но не записан явно.
export const CLIENT_TAGS = ["VIP", "Regular", "New", "Risky"];

export const SEED_COUNTERPARTIES = [
  { id: "cp1", nickname: "CryptoHouse", name: "Crypto House OTC", telegram: "@cryptohouse_otc", tag: "VIP", note: "OTC desk, large tickets" },
  { id: "cp2", nickname: "Murat Y.", name: "Murat Yildiz", telegram: "@murat_y", tag: "Regular", note: "" },
  { id: "cp3", nickname: "Boris L.", name: "Boris Levin", telegram: "@boris_lev", tag: "New", note: "" },
  { id: "cp4", nickname: "Office deposit", name: "Office Safe", telegram: "", tag: "", note: "Internal" },
];

// Типы счетов — для иконок и группировки в UI
export const ACCOUNT_TYPES = {
  bank: { label: "Bank", icon: "🏦" },
  cash: { label: "Cash", icon: "💵" },
  crypto: { label: "Crypto", icon: "🪙" },
  exchange: { label: "Exchange", icon: "📈" },
};

// Счета/кошельки. Каждый привязан к офису и валюте.
// Для crypto accounts добавлены поля для blockchain monitoring:
//   address          — on-chain адрес, по которому мониторится incoming
//   network          — TRC20 / ERC20 / ...
//   isDeposit        — если true, account принимает incoming (polling его отслеживает)
//   isWithdrawal     — если true, из account можно отправлять наружу
//   lastCheckedBlock — последний обработанный блок (for cursor); обновляется polling-циклом
//   lastCheckedAt    — ISO timestamp последнего тика polling
// Private keys не хранятся — account это чисто учётный объект.
export const SEED_ACCOUNTS = [
  // Mark Antalya
  { id: "a_mark_cash_usd", officeId: "mark", type: "cash", currency: "USD", channelId: "ch_usd_cash", name: "Cash · Safe A", active: true, balance: 18500 },
  { id: "a_mark_cash_try", officeId: "mark", type: "cash", currency: "TRY", channelId: "ch_try_cash", name: "Cash · Safe A", active: true, balance: 420000 },
  { id: "a_mark_bank_try", officeId: "mark", type: "bank", currency: "TRY", channelId: "ch_try_bank", name: "Bank · Garanti", active: true, balance: 1250000 },
  { id: "a_mark_crypto_usdt", officeId: "mark", type: "crypto", currency: "USDT", channelId: "ch_usdt_trc20", name: "TRC20 Main", active: true, balance: 45300,
    address: "TMarkAntalyaUsdtTrc20MainDepositAddr1", network: "TRC20", isDeposit: true, isWithdrawal: true,
    lastCheckedBlock: 0, lastCheckedAt: null },
  // Terra City
  { id: "a_terra_cash_usd", officeId: "terra", type: "cash", currency: "USD", channelId: "ch_usd_cash", name: "Cash · Main", active: true, balance: 12400 },
  { id: "a_terra_cash_try", officeId: "terra", type: "cash", currency: "TRY", channelId: "ch_try_cash", name: "Cash · Main", active: true, balance: 285000 },
  { id: "a_terra_crypto_usdt", officeId: "terra", type: "crypto", currency: "USDT", channelId: "ch_usdt_trc20", name: "TRC20 Hot", active: true, balance: 28700,
    address: "TTerraCityUsdtTrc20HotDepositAddr0002", network: "TRC20", isDeposit: true, isWithdrawal: true,
    lastCheckedBlock: 0, lastCheckedAt: null },
  // Istanbul
  { id: "a_ist_bank_usd", officeId: "ist", type: "bank", currency: "USD", channelId: "ch_usd_bank", name: "Bank · İş Bankası", active: true, balance: 52000 },
  { id: "a_ist_bank_try", officeId: "ist", type: "bank", currency: "TRY", channelId: "ch_try_bank", name: "Bank · Garanti", active: true, balance: 2100000 },
  { id: "a_ist_cash_eur", officeId: "ist", type: "cash", currency: "EUR", channelId: "ch_eur_cash", name: "Cash · Safe B", active: true, balance: 8200 },
  { id: "a_ist_crypto_usdt", officeId: "ist", type: "crypto", currency: "USDT", channelId: "ch_usdt_erc20", name: "ERC20 Main", active: true, balance: 67500,
    address: "0xIstanbulErc20MainDepositAddress0001abcd", network: "ERC20", isDeposit: true, isWithdrawal: true,
    lastCheckedBlock: 0, lastCheckedAt: null },
  { id: "a_ist_crypto_usdt2", officeId: "ist", type: "crypto", currency: "USDT", channelId: "ch_usdt_trc20", name: "TRC20 Hot", active: true, balance: 34000,
    address: "TIstanbulUsdtTrc20HotDepositAddress0003", network: "TRC20", isDeposit: true, isWithdrawal: true,
    lastCheckedBlock: 0, lastCheckedAt: null },
];

export const SEED_USERS = [
  { id: "u_ay", name: "A. Yilmaz", initials: "AY", role: "manager", email: "a.yilmaz@coinplata.io", officeId: "mark", active: true, createdAt: "2025-11-14" },
  { id: "u_sk", name: "S. Kaya", initials: "SK", role: "manager", email: "s.kaya@coinplata.io", officeId: "terra", active: true, createdAt: "2025-12-02" },
  { id: "u_md", name: "M. Demir", initials: "MD", role: "manager", email: "m.demir@coinplata.io", officeId: "ist", active: true, createdAt: "2026-01-08" },
  { id: "u_adm", name: "E. Kara", initials: "EK", role: "admin", email: "e.kara@coinplata.io", active: true, createdAt: "2025-09-01" },
  { id: "u_acc", name: "L. Özturk", initials: "LÖ", role: "accountant", email: "l.ozturk@coinplata.io", active: true, createdAt: "2025-10-20" },
];

export const officeName = (id) => OFFICES.find((o) => o.id === id)?.name || id;
