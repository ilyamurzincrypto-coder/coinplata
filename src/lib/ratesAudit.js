// src/lib/ratesAudit.js
// Проверка КАЖДОЙ котировки по одной — против живого рынка.
//
// ЗАЧЕМ ОТДЕЛЬНО ОТ ЗДОРОВЬЯ. Здоровье говорит про панель целиком: фиды живы,
// публикация свежая, покрытие полное. Но панель может быть полностью «зелёной»
// при одной перевёрнутой котировке — и именно одна строка стоит денег.
// Границы band_pct ловят отклонение от ВЧЕРАШНЕЙ цены и бессильны, если вчера
// уже было неверно. Рынок — независимый свидетель.
//
// ГЛАВНАЯ ПРОВЕРКА — ОРИЕНТАЦИЯ. Курс сравнивается с рыночным И с обратным
// рыночным. Если наше число ближе к ОБРАТНОМУ — курс перевёрнут: это класс
// багов B2/B3, при котором на экране правдоподобное число, а сделка убыточна
// в разы. Такую строку аудит называет прямо, а не «отклонением».
//
// ЧТО АУДИТ НЕ ДЕЛАЕТ: не чинит и не блокирует сам. Он отвечает «этой цифре
// можно верить?» — решение за человеком.

/** Насколько наш курс может отличаться от рынка: в нём наша маржа. */
export const DEV = { OK: 5, WARN: 15 };

export const VERDICT = { OK: "ok", WARN: "warn", BAD: "bad", NOREF: "noref" };

/** Ключ неупорядоченной пары: EUR/USDT и USDT/EUR — одна и та же пара. */
export function pairKey(a, b) {
  return [a, b].sort().join("|");
}

/**
 * Индекс рынка из external_rates.
 * Строка фида `USDT_TRY = 48.2` читается как «48.2 TRY за 1 USDT», то есть
 * base=USDT, quote=TRY, value = сколько quote за 1 base.
 *
 * Приоритет источников фиксирован: у пары бывает несколько котировок
 * (USD_TRY есть у tcmb, harem и tolunay), и брать «какую попало» значит
 * получать разный вердикт от прогона к прогону.
 */
export const SOURCE_PRIORITY = ["binance", "rapira", "tcmb", "ecb", "cbr", "harem", "tolunay"];

export function marketIndex(rows = []) {
  const idx = {};
  for (const r of rows) {
    const [base, quote] = String(r.pair || "").split("_");
    const value = Number(r.mid ?? r.bid ?? r.ask);
    if (!base || !quote || !(value > 0)) continue;
    const key = pairKey(base, quote);
    const rank = SOURCE_PRIORITY.indexOf(r.source);
    const prev = idx[key];
    if (prev && prev.rank <= (rank === -1 ? 99 : rank)) continue;
    idx[key] = { base, quote, value, source: r.source, fetchedAt: r.fetched_at, rank: rank === -1 ? 99 : rank };
  }
  return idx;
}

/** Отклонение в процентах, всегда положительное. */
function devPct(ours, ref) {
  return Math.abs(ours / ref - 1) * 100;
}

/**
 * Проверка одной котировки.
 *
 *   price  { block, scope, from, to, rate }
 *   market индекс из marketIndex()
 *
 * Возвращает { verdict, deviation, expected, inverted, reference, note }.
 * `inverted: true` — наше число совпало с ОБРАТНЫМ рыночным.
 */
export function auditQuote(price, market = {}) {
  const rate = Number(price?.rate);
  const base = { block: price?.block, scope: price?.scope ?? null, from: price?.from, to: price?.to, rate };

  if (!(rate > 0)) {
    return { ...base, verdict: VERDICT.BAD, note: "курс не число или ≤ 0" };
  }

  // Паритет USDT↔USD: рыночного тикера нет, но отклонение от единицы больше
  // пары процентов означало бы ошибку ввода, а не маржу.
  if (pairKey(price.from, price.to) === pairKey("USD", "USDT")) {
    const d = devPct(rate, 1);
    return {
      ...base,
      verdict: d <= 3 ? VERDICT.OK : d <= 10 ? VERDICT.WARN : VERDICT.BAD,
      deviation: d, expected: 1, inverted: false, reference: "паритет USDT≈USD",
      note: `${d.toFixed(2)}% от паритета`,
    };
  }

  const ref = market[pairKey(price.from, price.to)];
  if (!ref) {
    return { ...base, verdict: VERDICT.NOREF, note: "рыночной котировки нет — сверить нечем" };
  }

  // Рынок даёт «quote за 1 base». Наша строка тоже читаемое число, но её
  // ориентация зависит от того, какая валюта в паре слабее. Поэтому сверяем
  // с ОБЕИМИ трактовками и смотрим, к какой ближе.
  const direct = ref.value;
  const inverse = 1 / ref.value;
  const dDirect = devPct(rate, direct);
  const dInverse = devPct(rate, inverse);
  const inverted = dInverse < dDirect;
  const deviation = Math.min(dDirect, dInverse);
  const expected = inverted ? inverse : direct;

  // ВАЖНО: сама по себе «обратная ориентация» НЕ приговор. Нал берёт RUB/TRY
  // у Толуная как «лир за рубль» (0,50), а ЦБ котирует «рублей за лиру»
  // (1,80) — оба числа верны, просто в разных единицах. Объявлять такую
  // строку перевёрнутой значило бы поднимать тревогу каждый день на здоровой
  // цифре, и тревога перестала бы работать.
  // Опасна не ориентация сама по себе, а РАЗНОБОЙ ориентаций внутри одной
  // публикации — это ловит auditOrientation ниже.
  const verdict = deviation <= DEV.OK ? VERDICT.OK : deviation <= DEV.WARN ? VERDICT.WARN : VERDICT.BAD;
  return {
    ...base, verdict, deviation, expected, inverted,
    reference: `${ref.base}/${ref.quote} ${ref.source}`,
    note: `${deviation.toFixed(2)}% от рынка (${expected.toPrecision(6)})${inverted ? " · обратная ориентация" : ""}`,
  };
}

/**
 * Проверка обеих сторон пары: продажа не должна быть ВЫГОДНЕЕ покупки.
 * Если да — каждая сделка по такой паре несёт убыток, и никакой рынок этого
 * не покажет: обе котировки по отдельности выглядят нормально.
 */
export function auditSpread(prices = []) {
  const byKey = new Map();
  for (const p of prices) byKey.set(`${p.block}|${p.scope ?? ""}|${p.from}|${p.to}`, p);
  const out = [];
  const seen = new Set();

  for (const p of prices) {
    const backKey = `${p.block}|${p.scope ?? ""}|${p.to}|${p.from}`;
    const back = byKey.get(backKey);
    if (!back) continue;
    const tag = [`${p.from}|${p.to}`, `${p.to}|${p.from}`].sort().join("~") + `|${p.block}|${p.scope ?? ""}`;
    if (seen.has(tag)) continue;
    seen.add(tag);

    // Обе стороны — читаемые числа в одних единицах. Меняла обязан покупать
    // дешевле, чем продаёт: сторона «клиент отдаёт валюту» ≤ стороны
    // «клиент получает валюту».
    const lo = Math.min(p.rate, back.rate);
    const hi = Math.max(p.rate, back.rate);
    const spreadPct = ((hi - lo) / lo) * 100;
    out.push({
      block: p.block, scope: p.scope ?? null, pair: `${p.from}↔${p.to}`,
      low: lo, high: hi, spreadPct,
      verdict: spreadPct === 0 ? VERDICT.WARN : VERDICT.OK,
      note: spreadPct === 0 ? "обе стороны равны — спреда нет" : `спред ${spreadPct.toFixed(2)}%`,
    });
  }
  return out;
}

/**
 * РАЗНОБОЙ ОРИЕНТАЦИЙ — самая опасная проверка для моста.
 *
 * Одна и та же пара может уйти наружу в двух разных единицах: `RUB→TRY` в
 * одном блоке как «лир за рубль» (0,50), в другом как «рублей за лиру»
 * (1,97). Каждое число по отдельности сходится с рынком, здоровье зелёное,
 * границы молчат — а потребитель (сайт, бот, агрегатор) читает список цен по
 * ОДНОМУ правилу и половину строк понимает наоборот.
 *
 * Проверяем: у всех котировок одной валютной пары ориентация должна совпадать.
 */
export function auditOrientation(quotes = []) {
  const byPair = new Map();
  for (const q of quotes) {
    if (q.inverted === undefined || q.verdict === VERDICT.NOREF) continue;
    // Ключ НАПРАВЛЕННЫЙ: под каноном RUB→TRY и TRY→RUB законно смотрят в
    // разные стороны относительно одной рыночной котировки. Ошибка — когда
    // одно и то же направление приходит из разных блоков в разных единицах.
    const key = `${q.from}→${q.to}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(q);
  }
  const out = [];
  for (const [key, list] of byPair) {
    const groups = new Map();
    for (const q of list) {
      const g = q.inverted ? "inv" : "dir";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(q);
    }
    if (groups.size > 1) {
      const [a, b] = [...groups.values()];
      out.push({
        pair: key,
        verdict: VERDICT.BAD,
        examples: [a[0], b[0]].map((q) => `${q.block}${q.scope ? "·" + String(q.scope).slice(0, 8) : ""} ${q.from}→${q.to} = ${q.rate}`),
        note: "одна пара в двух ориентациях — потребитель поймёт половину наоборот",
      });
    }
  }
  return out;
}

/** Полный аудит публикации: по котировке + по парам + сводка. */
export function auditAll(prices = [], marketRows = []) {
  const market = marketIndex(marketRows);
  const quotes = prices.map((p) => auditQuote(p, market));
  const spreads = auditSpread(prices);
  const orientation = auditOrientation(quotes);
  const count = (v) => quotes.filter((q) => q.verdict === v).length;
  return {
    quotes,
    spreads,
    orientation,
    summary: {
      orientationClashes: orientation.length,
      total: quotes.length,
      ok: count(VERDICT.OK),
      warn: count(VERDICT.WARN),
      bad: count(VERDICT.BAD),
      noref: count(VERDICT.NOREF),

      noSpread: spreads.filter((s) => s.verdict !== VERDICT.OK).length,
    },
  };
}
