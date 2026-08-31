// src/lib/qrSpread.js
// Спред QR ₽ — ЕДИНАЯ ПРАВДА в rate_blocks.config.spread_pct (блок code='qr').
//
// ЧТО БЫЛО: боевой параметр ценообразования лежал в localStorage одного
// браузера с дефолтом «1». Чистка хранилища молча роняла спред с 8% на 1%,
// и курс приёма рублей уезжал в семь процентов мимо — это уже стреляло.
//
// ЧТО СТАЛО: значение читается из базы. localStorage остаётся ТОЛЬКО офлайн-
// кэшем последнего известного значения и никогда не является источником:
// если база недоступна, кэш показывается с явной пометкой, а если и кэша нет —
// панель честно говорит «спред не загружен» и НЕ подставляет число. Молчаливый
// дефолт — ровно тот механизм, который спрятал инцидент, поэтому его больше нет.
//
// ПРАВО ЗАПИСИ: RLS rate_blocks_update_admin — owner/admin. У менеджеров правка
// отключается в UI, а не падает в базе.

import { supabase } from "./supabase.js";

/** Ключ офлайн-кэша. Тот же, что был у localStorage-версии — значения переживают деплой. */
export const QR_SPREAD_KEY = "qr_spread_pct_v1";

/** Источники значения — для честной подписи в UI. */
export const QR_SOURCE = { DB: "db", CACHE: "cache", NONE: "none" };

function readCache() {
  try {
    const v = localStorage.getItem(QR_SPREAD_KEY);
    const n = v == null ? NaN : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeCache(value) {
  try {
    localStorage.setItem(QR_SPREAD_KEY, String(value));
  } catch {
    /* приватное окно — кэша просто не будет, база всё равно источник */
  }
}

/**
 * Текущий спред. Возвращает { value, source }:
 *   db    — из rate_blocks.config (норма)
 *   cache — база недоступна, показано последнее известное значение
 *   none  — ни базы, ни кэша: value === null, подставлять число нельзя
 */
export async function loadQrSpread() {
  if (!supabase) {
    const cached = readCache();
    return cached == null ? { value: null, source: QR_SOURCE.NONE } : { value: cached, source: QR_SOURCE.CACHE };
  }
  try {
    const { data, error } = await supabase
      .from("rate_blocks")
      .select("config")
      .eq("code", "qr")
      .maybeSingle();
    if (error) throw error;
    const n = Number(data?.config?.spread_pct);
    if (Number.isFinite(n)) {
      writeCache(n);
      return { value: n, source: QR_SOURCE.DB };
    }
  } catch {
    /* сеть/RLS — падаем на кэш ниже, но НЕ на выдуманное число */
  }
  const cached = readCache();
  return cached == null ? { value: null, source: QR_SOURCE.NONE } : { value: cached, source: QR_SOURCE.CACHE };
}

/**
 * Записать спред. Пишет ТОЛЬКО в базу; кэш обновляется следом, чтобы офлайн
 * показывал то же самое. Бросает — вызывающий обязан показать ошибку, а не
 * сделать вид, что сохранилось.
 */
export async function saveQrSpread(value) {
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) throw new Error("спред: не число");
  if (!supabase) throw new Error("Supabase не настроен");

  const { data, error } = await supabase
    .from("rate_blocks")
    .select("config")
    .eq("code", "qr")
    .maybeSingle();
  if (error) throw new Error(`спред: чтение блока — ${error.message}`);

  // Пишем целиком config: частичное обновление jsonb из PostgREST потребовало бы
  // RPC, а блок правит один человек за раз.
  const next = { ...(data?.config || {}), spread_pct: n };
  const { error: upErr } = await supabase
    .from("rate_blocks")
    .update({ config: next, updated_at: new Date().toISOString() })
    .eq("code", "qr");
  if (upErr) throw new Error(`спред: запись — ${upErr.message}`);

  writeCache(n);
  return n;
}

/** Может ли пользователь править спред (RLS: owner/admin). */
export function canEditQrSpread(user) {
  return user?.role === "owner" || user?.role === "admin";
}
