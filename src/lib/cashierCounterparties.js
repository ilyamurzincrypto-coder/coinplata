// src/lib/cashierCounterparties.js
// Данные для пикера контрагента в ленте «Сделки за день». Через существующий
// Supabase-клиент кассы (read clients разрешён RLS; insert clients — любой
// authenticated, т.е. роль manager). Поиск «по коду сделки» — за фиче-флагом:
// в кассе нет человекочитаемого кода сделки (deals.id = bigint; meeting_code
// живёт в CoinPoint / отдельный проект). См. docs/orders-in-ledger-compat.md.

import { supabase } from "./supabase.js";

// Источника «кода сделки» на стороне кассы нет → поиск по коду выключен.
export const DEAL_CODE_SEARCH_ENABLED = false;

function mapClient(r) {
  return {
    id: r.id,
    name: r.nickname || r.full_name || null,
    accountingCode: r.accounting_code || null,
    telegram: r.telegram || null,
    phone: r.phone || null,
  };
}

const SELECT_COLS = "id,nickname,full_name,accounting_code,telegram,phone";

// Последние использованные (по последним сделкам) → fallback: свежие clients.
export async function recentClients(limit = 6) {
  if (!supabase) return [];
  try {
    const { data: deals } = await supabase
      .from("deals")
      .select("client_id, created_at")
      .not("client_id", "is", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(40);
    const ids = [...new Set((deals || []).map((d) => d.client_id))].slice(0, limit);
    if (ids.length) {
      const { data } = await supabase.from("clients").select(SELECT_COLS).in("id", ids);
      const byId = new Map((data || []).map((c) => [c.id, c]));
      return ids.map((id) => byId.get(id)).filter(Boolean).map(mapClient);
    }
  } catch {
    /* fallback ниже */
  }
  const { data } = await supabase
    .from("clients")
    .select(SELECT_COLS)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data || []).map(mapClient);
}

// Серверный поиск: имя (nickname/full_name), код счёта (accounting_code),
// telegram или телефон (часто WhatsApp).
export async function searchClients(q, limit = 20) {
  if (!supabase) return [];
  const s = String(q || "").trim().replace(/[%,()]/g, "");
  if (!s) return [];
  const { data, error } = await supabase
    .from("clients")
    .select(SELECT_COLS)
    .or(
      `nickname.ilike.%${s}%,full_name.ilike.%${s}%,accounting_code.ilike.%${s}%,telegram.ilike.%${s}%,phone.ilike.%${s}%`
    )
    .is("archived_at", null)
    .limit(limit);
  if (error) throw error;
  return (data || []).map(mapClient);
}

// Поиск прошлой сделки по коду — за флагом (источника нет, см. шапку файла).
export async function findDealByCode(/* code */) {
  if (!DEAL_CODE_SEARCH_ENABLED) return null;
  return null;
}

// Создать контрагента. RLS: clients INSERT доступен authenticated (manager).
// № счёта тут не заводим (его назначает бухгалтер) — нужно хотя бы одно из
// имя/telegram/телефон.
export async function createCounterparty({ name, telegram, phone }) {
  if (!supabase) throw new Error("Supabase не настроен");
  const row = {
    nickname: name ? String(name).trim() : null,
    telegram: telegram ? String(telegram).trim() : null,
    phone: phone ? String(phone).trim() : null,
  };
  if (!row.nickname && !row.telegram && !row.phone) {
    throw new Error("Укажите имя, telegram или телефон");
  }
  const { data, error } = await supabase
    .from("clients")
    .insert(row)
    .select(SELECT_COLS)
    .single();
  if (error) throw error; // честный fail — права/ограничения видны вызывающему
  return mapClient(data);
}
