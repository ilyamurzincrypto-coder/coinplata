// src/lib/rateEngine.js
// ЕДИНСТВЕННЫЙ источник формул расчёта курсов (блочная модель).
//
// ЧИСТЫЙ МОДУЛЬ: ни одного импорта из приложения — ни стора, ни supabase, ни
// утилит. Только данные на входе, данные на выходе. Это условие того, чтобы один
// и тот же код гонялся и на сервере при публикации, и в редакторе для превью
// «Клиенту». Формула, написанная где-то ещё, — нарушение (сейчас их пять:
// utils/spread.js, lib/rapiraSpreads.js, QrRubPanel, RatesControlPanel,
// RatesAuxPanel; они уедут в фазе 4).
//
// КОНВЕНЦИЯ ЗНАЧЕНИЙ (инвариант 5 CLAUDE.md): курс хранится ЧИТАЕМЫМ числом > 1.
// TRY→USDT = 46.8 значит «46.8 TRY за 1 USDT», а не 0.0213. Движок НИЧЕГО не
// инвертирует сам: обе стороны пары — отдельные строки со своими значениями.
// Именно это убирает класс багов «перевёрнутая ориентация» (B2/B3).
//
// Формулы взяты из работающего кода, а не выдуманы:
//   pct     → 1 + v/100        (utils/morningRatesParser.js: resolveRateValue)
//   abs     → v                (значение уже читаемое)
//   derived → base × (1 + m/100)
//   source  → price × (1 + s/100)

/** Число или null. Строки с запятой тоже принимаются (утренний ввод). */
export function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Ключ строки прайса — стабильный, используется для сверки версий. */
export function priceKey({ block, scope, from, to }) {
  return `${block}|${scope || ""}|${from}|${to}`;
}

// ── цена одной строки ────────────────────────────────────────────────────

/**
 * Цена строки по её режиму.
 *   row    — { value_mode, value, from_ccy, to_ccy }
 *   block  — { kind, config }
 *   deps   — { sourcePrice, basePrice } (нужное для source/derived)
 * Возвращает { rate } либо { error } — молча null не отдаём, иначе строка
 * тихо выпадет из прайса.
 */
export function computeRowPrice(row, block, deps = {}) {
  const mode = row?.value_mode;

  if (mode === "pct") {
    const v = num(row.value);
    if (v == null) return { error: "pct: нет значения" };
    // Процент — маржа на паре ~1:1 (USDT↔USD): −0,8% → 0,992.
    return { rate: 1 + v / 100 };
  }

  if (mode === "abs") {
    const v = num(row.value);
    if (v == null) return { error: "abs: нет значения" };
    if (v <= 0) return { error: "abs: курс должен быть > 0" };
    return { rate: v };
  }

  if (mode === "derived") {
    const base = num(deps.basePrice);
    if (base == null) return { error: "derived: нет цены базового блока" };
    if (base <= 0) return { error: "derived: базовая цена должна быть > 0" };
    const m = num(block?.config?.margin_pct) ?? 0;
    return { rate: base * (1 + m / 100) };
  }

  if (mode === "source") {
    const p = num(deps.sourcePrice);
    if (p == null) return { error: "source: нет котировки провайдера" };
    if (p <= 0) return { error: "source: котировка должна быть > 0" };
    const s = num(block?.config?.spread_pct) ?? 0;
    return { rate: p * (1 + s / 100) };
  }

  return { error: `неизвестный value_mode: ${mode}` };
}

// ── границы отклонения ───────────────────────────────────────────────────

/**
 * Отклонение от предыдущей публикации, %. null — сравнивать не с чем
 * (первая публикация строки), это НЕ нарушение.
 */
export function deviationPct(next, prev) {
  const a = num(next);
  const b = num(prev);
  if (a == null || b == null || b === 0) return null;
  return (a / b - 1) * 100;
}

/** Нарушена ли граница band_pct. Первая публикация строки не нарушает. */
export function isOutOfBand(next, prev, bandPct) {
  const d = deviationPct(next, prev);
  if (d == null) return false;
  const band = num(bandPct);
  if (band == null) return false;
  return Math.abs(d) > band;
}

// ── полный расчёт ────────────────────────────────────────────────────────

/**
 * Считает весь прайс в порядке зависимостей (derived — после базового блока).
 *
 *   blocks   [{ code, kind, config, scopes, position, enabled }]
 *   rows     [{ block_code, scope, from_ccy, to_ccy, value_mode, value, band_pct, enabled }]
 *   sources  { "<provider>|<FROM>|<TO>": price } — котировки провайдеров
 *   previous { "<priceKey>": rate } — прошлая публикация (для границ)
 *
 * Возвращает { prices, errors, violations }. Ничего не бросает: вызывающий
 * решает, публиковать или показать список проблем.
 */
export function computeAll({ blocks = [], rows = [], sources = {}, previous = {} } = {}) {
  const byCode = new Map(blocks.filter((b) => b?.code).map((b) => [b.code, b]));

  // derived-блоки считаются после своих базовых: сортируем по глубине
  // зависимости, при равной — по position.
  const depth = (b, seen = new Set()) => {
    if (!b || b.kind !== "derived") return 0;
    const baseCode = b.config?.base_block_code;
    if (!baseCode || seen.has(b.code)) return 0; // цикл — не углубляемся
    seen.add(b.code);
    return 1 + depth(byCode.get(baseCode), seen);
  };
  const ordered = blocks
    .filter((b) => b?.enabled !== false)
    .slice()
    .sort((a, b) => depth(a) - depth(b) || (a.position ?? 0) - (b.position ?? 0));

  const prices = [];
  const errors = [];
  const violations = [];
  const byKey = new Map(); // priceKey → rate (для derived и для проверки границ)

  for (const block of ordered) {
    const blockRows = rows.filter((r) => r?.block_code === block.code && r?.enabled !== false);

    for (const row of blockRows) {
      const key = priceKey({
        block: block.code,
        scope: row.scope,
        from: row.from_ccy,
        to: row.to_ccy,
      });

      const deps = {};
      if (block.kind === "derived") {
        const baseCode = block.config?.base_block_code;
        deps.basePrice = byKey.get(
          priceKey({ block: baseCode, scope: row.scope, from: row.from_ccy, to: row.to_ccy })
        );
      }
      if (block.kind === "auto") {
        const provider = block.config?.provider;
        deps.sourcePrice = sources[`${provider}|${row.from_ccy}|${row.to_ccy}`];
      }

      const res = computeRowPrice(row, block, deps);
      if (res.error) {
        errors.push({ key, block: block.code, scope: row.scope, from: row.from_ccy, to: row.to_ccy, error: res.error });
        continue;
      }

      byKey.set(key, res.rate);
      prices.push({
        block: block.code,
        scope: row.scope ?? null,
        from: row.from_ccy,
        to: row.to_ccy,
        rate: res.rate,
      });

      if (isOutOfBand(res.rate, previous[key], row.band_pct)) {
        violations.push({
          key,
          block: block.code,
          scope: row.scope ?? null,
          from: row.from_ccy,
          to: row.to_ccy,
          rate: res.rate,
          previous: num(previous[key]),
          deviationPct: deviationPct(res.rate, previous[key]),
          bandPct: num(row.band_pct),
        });
      }
    }
  }

  return { prices, errors, violations };
}

/** Плоский прайс → мапа priceKey→rate (для сравнения версий и превью). */
export function pricesToMap(prices = []) {
  const m = {};
  for (const p of prices) {
    m[priceKey({ block: p.block, scope: p.scope, from: p.from, to: p.to })] = p.rate;
  }
  return m;
}

/**
 * Свежесть источников: публикация блокируется, если котировка старше maxAgeMs.
 * Протухшее молча брать нельзя — это прямое требование спеки.
 */
export function staleSources(sourceMeta = {}, nowMs, maxAgeMs = 2 * 60 * 60 * 1000) {
  const stale = [];
  for (const [provider, meta] of Object.entries(sourceMeta)) {
    const t = meta?.fetched_at ? new Date(meta.fetched_at).getTime() : NaN;
    if (!Number.isFinite(t)) {
      stale.push({ provider, reason: "нет отметки времени" });
      continue;
    }
    const age = nowMs - t;
    if (age > maxAgeMs) {
      stale.push({ provider, reason: "устарело", ageMs: age, maxAgeMs });
    }
  }
  return stale;
}
