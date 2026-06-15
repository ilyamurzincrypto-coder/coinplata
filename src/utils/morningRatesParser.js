// Парсер утреннего документа курсов («Paramon»). Чистый JS, без React/Supabase.
// Порт логики из coinpoint bot/src/util/rates-parser.ts, расширенный СБП/НЕРЕЗ.

export const KNOWN_CITIES = ["ANT", "IST", "MSK", "SPB"];

// city → список officeId. Пустой массив → строки города уходят в skipped.
export const CITY_OFFICE_MAP = {
  ANT: ["mark", "terra"],
  IST: ["ist"],
  MSK: [],
  SPB: [],
};

export function parseNumber(str) {
  if (typeof str !== "string") return NaN;
  return parseFloat(str.replace(",", "."));
}

// fromKind/toKind ∈ {"crypto","cash"} (из типа валюты: crypto | fiat→cash)
export function resolveRateValue({ value, pct }, fromKind, toKind) {
  if (!Number.isFinite(value)) return null;
  if (pct) return 1 + value / 100; // маржа на ~1:1 паре (USDT↔USD)
  const fromCash = fromKind !== "crypto";
  const toCash = toKind !== "crypto";
  if (!fromCash && toCash) return value; // crypto→cash: 1 USDT = N TRY
  if (fromCash && !toCash) return value === 0 ? null : 1 / value; // cash→crypto
  return value; // cash↔cash как есть
}
