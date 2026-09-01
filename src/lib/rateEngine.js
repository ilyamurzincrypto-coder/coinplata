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
//   derived → якорь / плечо   [блок с config.anchor: QR]
//   source  → price × (1 + s/100)   [spread_mode: pct]
//   source  → price + s/100         [spread_mode: abs — s в копейках]
//   замок   → зафиксированный итог, формула не применяется

/** Число или null. Строки с запятой тоже принимаются (утренний ввод). */
export function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Разбор маршрутного scope перестановок: "officeA→officeB" → {from, to}.
 * Не маршрут (город, базис TOD-TOM, null) → null. Это и есть проверка
 * «scope — измерение блока, а не обязательно город».
 */
export function parseRouteScope(scope) {
  if (typeof scope !== "string") return null;
  const parts = scope.split("→");
  if (parts.length !== 2) return null;
  const [from, to] = parts.map((x) => x.trim());
  return from && to ? { from, to } : null;
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

  // ЗАМОК. Меняла зафиксировал итог руками — курс перестаёт ходить за фидом,
  // пока замок не снят. Это не ещё одна формула, а её ОТСУТСТВИЕ, поэтому
  // проверка идёт до разбора режима: заперта может быть строка любого вида.
  // Семантика снята из работающей панели (RatesControlPanel: locks[key] —
  // зафиксированный итог, правка спреда замок снимает).
  const locked = num(row?.locked_rate);
  if (locked != null) {
    if (locked <= 0) return { error: "замок: курс должен быть > 0" };
    return { rate: locked, locked: true };
  }

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
    // Маржа строки перекрывает дефолт блока (решение №1): у «Москва → Liman»
    // своя, у остальных — общая.
    const m = num(row?.value) ?? num(block?.config?.margin_pct) ?? 0;

    // МАРШРУТ (scope = "officeA→officeB"): цепочка через USDT. Первое плечо
    // считается по курсу города ОТПРАВИТЕЛЯ, второе — города ПОЛУЧАТЕЛЯ.
    // Формула снята из старого редактора (RatesAuxPanel: base = uDep/uPay),
    // где uDep = USDT за 1 валюту отправителя = 1 / (валюта за 1 USDT).
    // Отсюда base = цена_получателя / цена_отправителя.
    // ЯКОРНЫЙ БЛОК (QR). Утреннее сообщение даёт ОДНУ строку — сколько рублей
    // за 1 USDT по СБП (93,45). Всё остальное считаем мы: клиент платит рубли
    // и получает валюту X, значит цена = якорь / (X за 1 USDT) в ЕГО городе.
    // Города обязательны: в Анталье USDT стоит одно, в Стамбуле другое, и
    // общий курс QR на оба города был бы ценой из воздуха.
    if (deps.anchorLeg) {
      const a = num(deps.anchorLeg.anchor);
      const u = num(deps.anchorLeg.unitPrice);
      if (a == null || a <= 0) return { error: "derived: нет якоря блока" };
      if (u == null || u <= 0) return { error: `derived: нет курса USDT→${row.to_ccy} в городе` };
      return { rate: (a / u) * (1 + m / 100) };
    }

    if (deps.routeLegs) {
      const { fromPrice, toPrice } = deps.routeLegs;
      const a = num(fromPrice);
      const b = num(toPrice);
      if (a == null || a <= 0) return { error: "derived: нет курса города-отправителя" };
      if (b == null || b <= 0) return { error: "derived: нет курса города-получателя" };
      return { rate: (b / a) * (1 + m / 100) };
    }

    const base = num(deps.basePrice);
    if (base == null) return { error: "derived: нет цены базового блока" };
    if (base <= 0) return { error: "derived: базовая цена должна быть > 0" };
    return { rate: base * (1 + m / 100) };
  }

  if (mode === "source") {
    const p = num(deps.sourcePrice);
    if (p == null) return { error: "source: нет котировки провайдера" };
    if (p <= 0) return { error: "source: котировка должна быть > 0" };
    // Спред строки перекрывает дефолт блока: у USD→TRY и TRY→USD он разный
    // (покупка и продажа), а config.spread_pct — общий старт для новых строк.
    // Для source-строк row.value ничем другим не занят.
    const s = num(row?.value) ?? num(block?.config?.spread_pct) ?? 0;
    // Решение №2: спред нала — АБСОЛЮТНЫЙ шаг в котируемой валюте (куруши),
    // а не процент. Меняла думает «плюс 5 копеек», и пересчёт в 0,1055%
    // потерял бы смысл шага. QR остаётся процентным.
    const mode2 = block?.config?.spread_mode === "abs" ? "abs" : "pct";
    // abs — КОПЕЙКИ (куруши), поэтому /100: «5» значит 0,05 TRY. Ровно так
    // считает работающая панель (RatesControlPanel: price + spread / 100).
    // Без деления «плюс 5 копеек» превратилось бы в «плюс 5 лир».
    const rate = mode2 === "abs" ? p + s / 100 : p * (1 + s / 100);
    if (!(rate > 0)) return { error: "source: спред увёл курс в ноль или минус" };
    return { rate };
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
 *   officeCity { "<office_id>": "ANT" } — маппинг офисов на города-scope
 *              базового блока; нужен только маршрутным derived-строкам
 *
 * Возвращает { prices, errors, violations }. Ничего не бросает: вызывающий
 * решает, публиковать или показать список проблем.
 */
export function computeAll({ blocks = [], rows = [], sources = {}, previous = {}, officeCity = {} } = {}) {
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

    // Якорь блока считается ПЕРВЫМ: его производные строки без него не имеют
    // смысла, а полагаться на порядок строк в массиве — значит зависеть от
    // position в базе, который может поменяться при любой правке.
    const anchorCfg = block.config?.anchor;
    const anchorRow = anchorCfg
      ? blockRows.find((r) => r.from_ccy === anchorCfg.from && r.to_ccy === anchorCfg.to)
      : null;
    let anchorValue = null;
    if (anchorRow) {
      const res = computeRowPrice(anchorRow, block, {});
      if (!res.error) anchorValue = res.rate;
    }

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
        const route = parseRouteScope(row.scope);
        if (anchorCfg && row !== anchorRow) {
          // Плечо — курс «X за 1 USDT» из базового блока в городе этой строки.
          deps.anchorLeg = {
            anchor: anchorValue,
            unitPrice: byKey.get(priceKey({ block: baseCode, scope: row.scope, from: "USDT", to: row.to_ccy })),
          };
        } else if (route) {
          // Маршрут: плечи берём из базового блока по ГОРОДАМ офисов.
          // officeCity — данные снаружи (чистый модуль офисов не знает).
          const cityFrom = officeCity[route.from];
          const cityTo = officeCity[route.to];
          deps.routeLegs = {
            // «сколько валюты отправителя за 1 USDT» у города-отправителя
            fromPrice: byKey.get(priceKey({ block: baseCode, scope: cityFrom, from: "USDT", to: row.from_ccy })),
            // «сколько валюты получателя за 1 USDT» у города-получателя
            toPrice: byKey.get(priceKey({ block: baseCode, scope: cityTo, from: "USDT", to: row.to_ccy })),
          };
        } else {
          deps.basePrice = byKey.get(
            priceKey({ block: baseCode, scope: row.scope, from: row.from_ccy, to: row.to_ccy })
          );
        }
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
