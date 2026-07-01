// Парсер утреннего документа курсов («Paramon»). Чистый JS, без React/Supabase.
// Порт логики из coinpoint bot/src/util/rates-parser.ts, расширенный СБП/НЕРЕЗ.

export const KNOWN_CITIES = ["ANT", "IST", "MSK", "SPB"];

// Сопоставление city-кода документа с офисами — динамически по живому списку
// (в проде office.id это UUID, а не строки). Матчим по city ИЛИ name офиса.
export const CITY_OFFICE_MATCHERS = {
  ANT: (o) => /antal/i.test(`${o.city || ""} ${o.name || ""}`),
  IST: (o) => /istanbul|стамбул/i.test(`${o.city || ""} ${o.name || ""}`),
  // MSK → любой московский офис: «Москва Вася» (city «Москва») И «Moscow».
  // Раньше требовалось ровно «moscow» и активная «Москва Вася» пролетала мимо.
  MSK: (o) => /москв|moscow/i.test(`${o.city || ""} ${o.name || ""}`),
  SPB: (o) => /st\.?\s*pt|spb|peterburg|petersburg|питер|санкт|спб/i.test(`${o.city || ""} ${o.name || ""}`),
};

// resolveCityOffices(city, offices) -> [officeId,...]
export function resolveCityOffices(city, offices) {
  const match = CITY_OFFICE_MATCHERS[city];
  if (!match || !Array.isArray(offices)) return [];
  return offices.filter((o) => o && match(o)).map((o) => o.id);
}

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
const SBP_RE = /^([A-Za-z]{2,6})\s+QR\s+СБП\s*>>\s*([A-Za-z]{2,6})\s+([+-]?\d+(?:[.,]\d+)?)$/i;
const NEREZ_HEADER_RE = /^[A-Za-z]{2,6}\s*[-–]\s*[A-Za-z]{2,6}\s*\(\s*НЕРЕЗ\s*\)/i;
const NEREZ_SIDE_RE = /^(Sell|Buy)\s*:?\s*$/i;
const NEREZ_SETTLE_RE = /^(TOD-TOD|TOD-TOM|TOM-TOM)\s+([+-]?\d+(?:[.,]\d+)?)$/i;

function stripMetadata(line) {
  let s = line.replace(META_RE, "");
  s = s.replace(PARAMON_RE, "");
  return s.trim();
}

export function parseMorningRates(text) {
  const anchors = [];
  const special = []; // СБП + НЕРЕЗ-записи
  const skipped = [];
  let currentCity = null;
  let nerezPair = null; // напр. "USDT/RUB" когда активен блок НЕРЕЗ
  let nerezSide = null; // "sell" | "buy"

  for (const rawLine of String(text).split(/\r?\n/)) {
    const original = rawLine.trim();
    if (!original) continue;
    if (original.startsWith("//") || original.startsWith("#")) continue;

    let line = stripMetadata(original);
    if (!line) continue;

    const stand = STANDALONE_CITY_RE.exec(line);
    if (stand) {
      currentCity = stand[1].toUpperCase();
      nerezPair = null; nerezSide = null;
      continue;
    }
    const inline = INLINE_CITY_RE.exec(line);
    if (inline) {
      currentCity = inline[1].toUpperCase();
      line = inline[2].trim();
    }

    // СБП: «RUB QR СБП>> USDT 75,50»
    const sbp = SBP_RE.exec(line);
    if (sbp) {
      const v = parseNumber(sbp[3]);
      if (Number.isFinite(v)) {
        special.push({ kind: "sbp", from: sbp[1].toUpperCase(), to: sbp[2].toUpperCase(), value: v, raw: original });
      } else {
        skipped.push({ line: original, reason: "invalid number" });
      }
      continue;
    }
    // Заголовок блока НЕРЕЗ: «USDT - RUB (НЕРЕЗ)»
    if (NEREZ_HEADER_RE.test(line)) {
      const codes = (line.match(/[A-Za-z]{2,6}/g) || []).slice(0, 2);
      nerezPair = codes.length === 2 ? `${codes[0].toUpperCase()}/${codes[1].toUpperCase()}` : "USDT/RUB";
      nerezSide = null;
      continue;
    }
    if (nerezPair) {
      const side = NEREZ_SIDE_RE.exec(line);
      if (side) { nerezSide = side[1].toLowerCase(); continue; }
      const st = NEREZ_SETTLE_RE.exec(line);
      if (st) {
        const v = parseNumber(st[2]);
        if (Number.isFinite(v) && nerezSide) {
          special.push({ kind: "nerez", pair: nerezPair, side: nerezSide, settle: st[1].toUpperCase(), value: v, raw: original });
        } else {
          skipped.push({ line: original, reason: "nerez: нет side/число" });
        }
        continue;
      }
      // строка не относится к НЕРЕЗ — выходим из режима и обрабатываем обычно
      nerezPair = null;
      nerezSide = null;
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

// kindOf(code) -> "crypto" | "cash"; offices — живой список из useOffices()
export function buildMorningUpdates(parsed, kindOf, offices) {
  const updates = [];
  const skipped = [...(parsed.skipped || [])];
  for (const a of parsed.anchors) {
    // только якоря: одна сторона USDT
    if (a.from !== "USDT" && a.to !== "USDT") continue;
    const officeIds = resolveCityOffices(a.city, offices);
    if (officeIds.length === 0) {
      skipped.push({ line: a.raw, reason: `нет офиса для ${a.city}` });
      continue;
    }
    const rate = resolveRateValue(a, kindOf(a.from), kindOf(a.to));
    if (rate == null || !Number.isFinite(rate) || rate <= 0) {
      skipped.push({ line: a.raw, reason: "invalid rate" });
      continue;
    }
    for (const officeId of officeIds) {
      updates.push({ officeId, from: a.from, to: a.to, rate, city: a.city, raw: a.raw });
    }
  }
  return { updates, skipped };
}

// lookup(a,b) -> number|undefined: ТОЛЬКО прямой курс (без пивота).
// Возвращает производный кросс через USDT или undefined.
export function pivotRate(from, to, lookup) {
  if (from === to) return 1;
  if (from === "USDT" || to === "USDT") return undefined;
  const leg1 = lookup(from, "USDT");
  const leg2 = lookup("USDT", to);
  if (Number.isFinite(leg1) && leg1 > 0 && Number.isFinite(leg2) && leg2 > 0) return leg1 * leg2;
  return undefined;
}
