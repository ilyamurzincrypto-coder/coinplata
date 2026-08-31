// src/lib/ratesV2.js
// Доступ к блочной модели курсов (фаза 2а). Читает rate_blocks / rate_rows /
// последнюю публикацию, публикует через RPC publish_rates.
//
// ГДЕ ЖИВЁТ РАСЧЁТ (ответ на вопрос владельца в PR-A): сейчас — НА КЛИЕНТЕ.
// Редактор считает прайс модулем rateEngine и присылает готовые цены в RPC,
// а RPC проверяет границы и свежесть и пишет атомарно. Для теневого режима
// это правильно: одна реализация формул, никакого plpgsql-двойника. ВОРОТА
// ФАЗЫ 2: перед включением моста тот же rateEngine поднимается в edge-функцию,
// и публикация считается сервером; превью в редакторе остаётся клиентским.
// Модуль при этом остаётся один.
//
// ТЕНЕВОЙ РЕЖИМ: публикации никуда не уходят — моста нет, каналы читают
// старый путь. rate_publications — append-only журнал (RLS без delete).

import { supabase } from "./supabase.js";

/** Фича-флаг. Персональный: users.preferences.rates_v2_ui === true. */
export function isRatesV2Enabled(user) {
  return user?.preferences?.rates_v2_ui === true;
}

export const V2_BANNER =
  "тестовый режим · публикации не уходят в каналы · рабочие курсы — в старом редакторе";

/** Блоки с их строками, по position. */
export async function loadBlocks() {
  if (!supabase) return [];
  const { data: blocks, error: e1 } = await supabase
    .from("rate_blocks")
    .select("id, code, title, kind, config, scopes, position, enabled")
    .order("position");
  if (e1) throw new Error(`loadBlocks: ${e1.message}`);

  const { data: rows, error: e2 } = await supabase
    .from("rate_rows")
    .select("id, block_id, scope, from_ccy, to_ccy, value_mode, value, band_pct, position, enabled")
    .order("position");
  if (e2) throw new Error(`loadBlocks rows: ${e2.message}`);

  const byBlock = new Map();
  for (const r of rows || []) {
    if (!byBlock.has(r.block_id)) byBlock.set(r.block_id, []);
    byBlock.get(r.block_id).push(r);
  }
  return (blocks || []).map((b) => ({ ...b, rows: byBlock.get(b.id) || [] }));
}

/** Последняя публикация или null (публикаций ещё нет). */
export async function loadPublished() {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_published_rates");
  if (error) throw new Error(`get_published_rates: ${error.message}`);
  return data || null;
}

/** Плоский прайс последней публикации → мапа priceKey→rate (для «Было»). */
export function publishedMap(published) {
  const m = {};
  for (const p of published?.prices || []) {
    m[`${p.block}|${p.scope || ""}|${p.from}|${p.to}`] = Number(p.rate);
  }
  return m;
}

/**
 * Публикация. Возвращает ответ RPC как есть: { ok:true, version } либо
 * { ok:false, error, violations|stale } — вызывающий показывает список,
 * ничего не додумывая.
 */
export async function publishRates({ inputs, prices, sourceMeta }) {
  if (!supabase) throw new Error("Supabase не настроен");
  const { data, error } = await supabase.rpc("publish_rates", {
    p_inputs: inputs || {},
    p_prices: prices || [],
    p_source_meta: sourceMeta || {},
  });
  if (error) throw new Error(`publish_rates: ${error.message}`);
  return data;
}

/** Маппинг офис→город-scope для маршрутных строк (перестановки). */
export function officeCityMap(offices) {
  const CITY = [
    [/antal/i, "ANT"],
    [/istanbul|стамбул/i, "IST"],
    [/москв|moscow/i, "MSK"],
    [/spb|питер|санкт|петербург/i, "SPB"],
  ];
  const m = {};
  for (const o of offices || []) {
    const hay = `${o.city || ""} ${o.name || ""}`;
    const hit = CITY.find(([re]) => re.test(hay));
    if (hit) m[o.id] = hit[1];
  }
  return m;
}
