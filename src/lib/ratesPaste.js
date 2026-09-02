// src/lib/ratesPaste.js
// Адаптер «утренний документ → черновик блочной модели» (фаза 2а, PR-B2).
//
// ЧИСТЫЙ МОДУЛЬ: только парсер (utils/morningRatesParser) и данные. Ни стора,
// ни supabase — как rateEngine. Это единственное место, где текст Paramon
// превращается в значения строк rate_rows.
//
// ГЛАВНОЕ ПРАВИЛО: в поле кладётся СЫРОЕ значение из документа, а не
// посчитанный курс. «USDT -> USD (-1,00%)» кладёт −1, а не 0.99: пересчёт —
// работа rateEngine, и он должен остаться единственным местом, где формула
// живёт. Если бы адаптер клал 0.99, в поле процента появилось бы число,
// которого меняла в документе не видел, и «Было/Стало» перестали бы сходиться.
//
// НЕРАСПОЗНАННОЕ НЕ БЛОКИРУЕТ: документ приходит живым текстом со звонками и
// пометками. Строка, которую не удалось разобрать, попадает в список
// «не распознано» и остаётся человеку — вставка всё равно применяется.

import { parseMorningRates } from "../utils/morningRatesParser.js";
import { toCanonical } from "./rateOrientation.js";

/** Строки НЕРЕЗ: сторона документа → направление пары в модели. */
const NEREZ_SIDE_DIR = {
  sell: (base, quote) => ({ from: base, to: quote }), // продаём USDT за RUB
  buy: (base, quote) => ({ from: quote, to: base }),  // покупаем USDT за RUB
};

/** Индекс строк всех блоков: block|scope|from|to → row (+ block). */
function indexRows(blocks) {
  const idx = new Map();
  for (const b of blocks || []) {
    for (const r of b.rows || []) {
      idx.set(`${b.code}|${r.scope ?? ""}|${r.from_ccy}|${r.to_ccy}`, { row: r, block: b });
    }
  }
  return idx;
}

/**
 * Разбирает текст и раскладывает по строкам модели.
 *
 *   blocks — из loadBlocks() (с rows)
 *   text   — вставленный документ
 *
 * Возвращает:
 *   draft      { rowId: строковое значение } — готово к setDraft
 *   closed     { rowId: true } — «сегодня не торгуем» (прочерк в сообщении)
 *   matched    [{ rowId, block, scope, from, to, value, raw }]
 *   unmatched  [{ raw, reason }] — не распознано ИЛИ распознано, но некуда класть
 */

export function pasteToDraft({ blocks = [], text = "" } = {}) {
  const parsed = parseMorningRates(text);
  const idx = indexRows(blocks);
  const draft = {};
  const closed = {};   // rowId → true: «сегодня не торгуем»
  const matched = [];
  const unmatched = (parsed.skipped || []).map((s) => ({ raw: s.line, reason: s.reason }));

  const put = (key, value, info) => {
    const hit = idx.get(key);
    if (!hit) return false;
    const { row } = hit;
    if (row.enabled === false) {
      unmatched.push({ raw: info.raw, reason: `строка выключена: ${info.label}` });
      return true; // разобрали, но класть некуда — не «не распознано»
    }
    // В pct-строку кладём сырой процент — у него нет ориентации. В abs-строку
    // кладём КАНОН: «сколько to за 1 from». Документ пишет «слабая за 1
    // сильную», и без перевода одна и та же пара уезжала бы в модель в двух
    // разных единицах (см. lib/rateOrientation).
    const stored = row.value_mode === "abs" ? toCanonical(info.from, info.to, value) : value;
    if (stored == null) {
      unmatched.push({ raw: info.raw, reason: `${info.label}: значение не переводится в курс` });
      return true;
    }
    draft[row.id] = String(stored).replace(".", ",");
    matched.push({ rowId: row.id, ...info, value });
    return true;
  };

  // ── якоря: город + пара ───────────────────────────────────────────────
  for (const a of parsed.anchors || []) {
    const label = `${a.city} ${a.from}→${a.to}`;
    const key = `usdt|${a.city}|${a.from}|${a.to}`;
    const hit = idx.get(key);
    if (!hit) {
      // Город не в scopes блока (закрытое направление) или пары нет в модели —
      // это не ошибка документа, а разница модели и документа. Говорим прямо.
      unmatched.push({ raw: a.raw, reason: `нет строки ${label} в модели` });
      continue;
    }
    // Режим строки должен совпасть с формой значения в документе: процент
    // из документа в abs-строку положить нельзя — получится курс 1,00.
    const wantPct = a.pct === true;
    const isPct = hit.row.value_mode === "pct";
    if (wantPct !== isPct) {
      unmatched.push({
        raw: a.raw,
        reason: isPct ? `${label}: строка в процентах, в документе абсолют` : `${label}: строка в абсолюте, в документе процент`,
      });
      continue;
    }
    put(key, a.value, { block: "usdt", scope: a.city, from: a.from, to: a.to, raw: a.raw, label });
  }

  // ── спец-записи: СБП (QR) и НЕРЕЗ ─────────────────────────────────────
  for (const s of parsed.special || []) {
    if (s.kind === "sbp") {
      // QR-блок городской: одно значение документа ложится во ВСЕ города блока
      // (в документе СБП идёт без города — это общий курс приёма рублей).
      const qr = (blocks || []).find((b) => b.code === "qr");
      // Строки QR могут быть общими (scope null — один курс приёма на все
      // города) или городскими. Сначала пробуем городские, и только если ни
      // одна не нашлась — общую: иначе одно значение легло бы дважды.
      const scoped = qr?.scopes?.length ? qr.scopes : [];
      const hasScoped = scoped.some((sc) => idx.has(`qr|${sc}|${s.from}|${s.to}`));
      const scopes = hasScoped ? scoped : [null];
      let placed = false;
      for (const sc of scopes) {
        const label = `QR ${s.from}→${s.to}${sc ? ` · ${sc}` : ""}`;
        if (put(`qr|${sc ?? ""}|${s.from}|${s.to}`, s.value, { block: "qr", scope: sc, from: s.from, to: s.to, raw: s.raw, label })) {
          placed = true;
        }
      }
      if (!placed) unmatched.push({ raw: s.raw, reason: `нет строки QR ${s.from}→${s.to} в модели` });
      continue;
    }

    if (s.kind === "nerez") {
      const [base, quote] = String(s.pair || "USDT/RUB").split("/");
      const dir = NEREZ_SIDE_DIR[s.side];
      if (!dir) {
        unmatched.push({ raw: s.raw, reason: "НЕРЕЗ: неизвестная сторона" });
        continue;
      }
      const { from, to } = dir(base, quote);
      const label = `НЕРЕЗ ${s.settle} ${from}→${to}`;
      const hit = idx.get(`nerez|${s.settle}|${from}|${to}`);
      if (!hit) {
        unmatched.push({ raw: s.raw, reason: `нет строки ${label} в модели` });
        continue;
      }
      if (s.closed) {
        // «Не торгуем»: значение снимаем И помечаем строку закрытой, иначе
        // вчерашняя цена унаследуется и уедет в публикацию как сегодняшняя.
        closed[hit.row.id] = true;
        delete draft[hit.row.id];
        matched.push({ rowId: hit.row.id, block: "nerez", scope: s.settle, from, to, raw: s.raw, label, value: null, closed: true });
        continue;
      }
      put(`nerez|${s.settle}|${from}|${to}`, s.value, { block: "nerez", scope: s.settle, from, to, raw: s.raw, label });
    }
  }

  return { draft, closed, matched, unmatched };
}

/** Сводка распознавания для шапки окна вставки. */
export function pasteSummary({ matched = [], unmatched = [] } = {}) {
  const byBlock = {};
  const withValue = matched.filter((m) => !m.closed);
  for (const m of withValue) byBlock[m.block] = (byBlock[m.block] || 0) + 1;
  return {
    total: withValue.length,
    byBlock,
    unmatched: unmatched.length,
    closed: matched.length - withValue.length,
  };
}
