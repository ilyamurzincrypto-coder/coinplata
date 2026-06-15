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

// Регэкспы строк
const RATE_RE = /^([A-Za-z]{2,6})\s*(?:->|=>|→)\s*([A-Za-z]{2,6})\s+\(?([+-]?\d+(?:[.,]\d+)?)\s*(%?)\)?$/;
const INLINE_CITY_RE = /^(ANT|IST|MSK|SPB)\s+(.+)$/i;
const STANDALONE_CITY_RE = /^(ANT|IST|MSK|SPB)\s*:?\s*$/i;
const META_RE = /^\[\d{1,2}[.\d]*\s+[\d:]+\]\s*/; // [DD.MM(.YYYY) HH:MM]
const PARAMON_RE = /^(?:Paramon:\s*)+/i;

function stripMetadata(line) {
  let s = line.replace(META_RE, "");
  s = s.replace(PARAMON_RE, "");
  return s.trim();
}

export function parseMorningRates(text) {
  const anchors = [];
  const special = []; // заполнится в Task 3
  const skipped = [];
  let currentCity = null;

  for (const rawLine of String(text).split(/\r?\n/)) {
    const original = rawLine.trim();
    if (!original) continue;
    if (original.startsWith("//") || original.startsWith("#")) continue;

    let line = stripMetadata(original);
    if (!line) continue;

    const stand = STANDALONE_CITY_RE.exec(line);
    if (stand) {
      currentCity = stand[1].toUpperCase();
      continue;
    }
    const inline = INLINE_CITY_RE.exec(line);
    if (inline) {
      currentCity = inline[1].toUpperCase();
      line = inline[2].trim();
    }

    const m = RATE_RE.exec(line);
    if (!m) {
      skipped.push({ line: original, reason: "unparseable" });
      continue;
    }
    if (!currentCity) {
      skipped.push({ line: original, reason: "no-city (нет city-заголовка перед строкой)" });
      continue;
    }
    const value = parseNumber(m[3]);
    if (!Number.isFinite(value)) {
      skipped.push({ line: original, reason: "invalid number" });
      continue;
    }
    anchors.push({
      city: currentCity,
      from: m[1].toUpperCase(),
      to: m[2].toUpperCase(),
      value,
      pct: m[4] === "%",
      raw: original,
    });
  }

  return { anchors, special, skipped };
}
