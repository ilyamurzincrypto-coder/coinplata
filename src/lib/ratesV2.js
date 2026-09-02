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
import { CITY_OFFICE_MATCHERS } from "../utils/morningRatesParser.js";

/** Фича-флаг. Персональный: users.preferences.rates_v2_ui === true. */
export function isRatesV2Enabled(user) {
  return user?.preferences?.rates_v2_ui === true;
}

// Баннер честно описывает состояние моста: пока рубильник RATES_BRIDGE_ENABLED
// выключен, публикация считается и сохраняется, но наружу не уходит.
export const V2_BANNER =
  "тестовый режим · мост выключен рубильником · рабочие курсы — в старом редакторе";

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

/**
 * Котировки провайдеров для auto-блоков (нал, QR).
 *
 * СТОРОНА ФИДА — порт из работающей панели (RatesControlPanel: «CUR→TRY =
 * Покупка (bid), TRY→CUR = Продажа (ask)»). Пара фида X_Y раскладывается
 * в ДВА ключа: X→Y берёт bid, Y→X берёт 1/ask. Оба — в КАНОНЕ «сколько
 * второй валюты за 1 первую», как и ручные строки.
 *
 * Возвращает { sources: {"<provider>|<FROM>|<TO>": price},
 *              meta: {"<provider>": {fetched_at, age_min}} }.
 */
export async function loadSources(providers = []) {
  if (!supabase || providers.length === 0) return { sources: {}, meta: {} };
  const { data, error } = await supabase
    .from("external_rates")
    .select("source, pair, bid, ask, mid, fetched_at")
    .in("source", providers)
    .gte("fetched_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
    .order("fetched_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`loadSources: ${error.message}`);

  const sources = {};
  const meta = {};
  const seen = new Set(); // берём только САМЫЙ СВЕЖИЙ снимок каждой пары
  for (const r of data || []) {
    const tag = `${r.source}|${r.pair}`;
    if (seen.has(tag)) continue;
    seen.add(tag);
    const [x, y] = String(r.pair).split("_");
    if (!x || !y) continue;
    const mid = Number(r.mid);
    const bid = Number(r.bid ?? mid);
    const ask = Number(r.ask ?? mid);
    // Канон: значение ключа «A|B» — сколько B за 1 A.
    // bid пары X_Y уже «Y за 1 X». ask — тоже «Y за 1 X», поэтому для
    // обратного ключа его надо ПЕРЕВЕРНУТЬ, а не класть как есть: иначе
    // строка TRY→USD хранила бы «лиры за доллар» под видом «долларов за лиру».
    if (Number.isFinite(bid)) sources[`${r.source}|${x}|${y}`] = bid;
    if (Number.isFinite(ask) && ask > 0) sources[`${r.source}|${y}|${x}`] = 1 / ask;
    if (!meta[r.source] || meta[r.source].fetched_at < r.fetched_at) {
      meta[r.source] = { fetched_at: r.fetched_at };
    }
  }
  for (const m of Object.values(meta)) {
    m.age_min = Math.round((Date.now() - new Date(m.fetched_at).getTime()) / 60000);
  }
  return { sources, meta };
}

/** Лента версий для Экрана 3. */
export async function loadPublications(limit = 12) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("get_rate_publications", { p_limit: limit });
  if (error) throw new Error(`get_rate_publications: ${error.message}`);
  return data || [];
}

/**
 * Откат к версии. Публикует её цены НОВОЙ версией — журнал append-only,
 * старое не переписывается, и в ленте видно сам факт отката.
 */
export async function rollbackRates(version) {
  if (!supabase) throw new Error("Supabase не настроен");
  const { data, error } = await supabase.rpc("rollback_rates", { p_version: version });
  if (error) throw new Error(`rollback_rates: ${error.message}`);
  return data;
}

/**
 * Доставка опубликованной версии в каналы. Вызывает серверную функцию —
 * секрет CoinPoint во фронт не попадает. Идемпотентность на номере версии:
 * повтор и ручное «переотправить» используют один ключ.
 */
export async function deliverPublication(version, { force = false } = {}) {
  if (!supabase) throw new Error("Supabase не настроен");
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const r = await fetch("/api/rates/deliver", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ version, force }),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: text.slice(0, 200) }; }
  if (!r.ok) throw new Error(json.error || `доставка: ${r.status}`);
  return json;
}

/**
 * Живой рынок для аудита котировок — независимый свидетель против наших цен.
 * Вьюха отдаёт последнюю котировку каждой пары (после фикса skip-scan — 8 мс).
 */
export async function loadMarket() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_external_rates_latest")
    .select("source, pair, bid, ask, mid, fetched_at");
  if (error) throw new Error(`loadMarket: ${error.message}`);
  return data || [];
}

/**
 * Маппинг офис→код города для маршрутных и городских строк.
 *
 * Матчер ИМПОРТИРУЕТСЯ, а не копируется. Здесь была своя копия правил, и она
 * уже разошлась с оригиналом: «St.pt» не подходил под /spb|питер|санкт/ и
 * питерский офис не резолвился ни в один город. Копия помощника всегда
 * отстаёт от оригинала — это ровно тот случай, ради которого правило
 * «импортировать, а не копировать» и записано.
 */
export function officeCityMap(offices) {
  const m = {};
  for (const o of offices || []) {
    for (const [code, match] of Object.entries(CITY_OFFICE_MATCHERS)) {
      if (match(o)) { m[o.id] = code; break; }
    }
  }
  return m;
}
