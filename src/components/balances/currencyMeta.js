// src/components/balances/currencyMeta.js
// Меты валют для блока «Остатки в кассе» (символ + цвета чипа из прототипа
// coinplata-cashier) и ru-RU форматтеры чисел. Без JSX — общий модуль.

export const BAL_COLUMNS = ["USDT", "USD", "EUR", "TRY", "RUB", "GBP", "CHF"];

// Символ + цвета чипа (light-тема прототипа). dp — знаки после запятой (undefined = авто).
export const CCY_META = {
  USDT: { sym: "₮", bg: "#e6f7f2", fg: "#0f9d8a", dp: 2 },
  USD: { sym: "$", bg: "#e7f6ee", fg: "#0d8f63" },
  EUR: { sym: "€", bg: "#e8f0fd", fg: "#2f6fd0" },
  TRY: { sym: "₺", bg: "#fdeceb", fg: "#cf3d59" },
  RUB: { sym: "₽", bg: "#efeafd", fg: "#6f53d4" },
  GBP: { sym: "£", bg: "#fef3e6", fg: "#c4791a" },
  CHF: { sym: "₣", bg: "#eef0f4", fg: "#6b7186" },
};

export function ccyMeta(ccy) {
  return CCY_META[ccy] || { sym: String(ccy || "")[0] || "•", bg: "#eef0f4", fg: "#6b7186" };
}

// ru-RU: пробел тысяч, запятая десятичная. dp по валюте, иначе авто (0 для целых).
export function fmtRu(n, dp) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const d = dp != null ? dp : Number.isInteger(v) ? 0 : 2;
  return v.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Разбивка строки на целую/дробную часть (для бледной дробной части).
export function splitParts(s) {
  const i = s.indexOf(",");
  return i < 0 ? { int: s, dec: "" } : { int: s.slice(0, i), dec: s.slice(i) };
}
