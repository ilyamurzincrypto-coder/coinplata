// src/lib/managerOrders.js
// Заявки менеджера (manager_orders) — за фиче-флагом VITE_MANAGER_ORDERS_ENABLED.
// Пока таблица не применена (см. supabase/migrations/manager_orders_1_create.sql)
// флаг = false → касса работает как раньше. Нормализовано под будущие сайтовые
// заявки: общий тип «заявка» для ленты и «Под заявки».

import { supabase } from "./supabase.js";

export const MANAGER_ORDERS_ENABLED =
  import.meta.env?.VITE_MANAGER_ORDERS_ENABLED === "true";

// Короткий читаемый код заявки/встречи (для устной координации и привязки).
export function genOrderCode() {
  const s = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CP-${s}`;
}

function mapOrder(r) {
  return {
    id: r.id,
    isOrder: true,
    source: "manager",
    kind: r.kind, // 'exchange' | 'visit'
    officeId: r.office_id,
    contact: r.contact || "",
    clientId: r.client_id || null,
    fromCurrency: r.from_currency ? String(r.from_currency).toUpperCase() : null,
    fromAmount: Number(r.from_amount) || 0,
    rate: r.rate != null ? String(r.rate) : null,
    toCurrency: r.to_currency ? String(r.to_currency).toUpperCase() : null,
    toAmount: Number(r.to_amount) || 0,
    status: r.status,
    arrivedAt: r.arrived_at || null,
    dealId: r.deal_id || null,
    note: r.note || null,
    meetingCode: r.meeting_code || null,
    meetingAt: r.meeting_at || null,
    createdAt: r.created_at,
    createdBy: r.created_by || null,
    sourceOrderId: r.source_order_id || null, // из coinpoint-бота, если задан
  };
}

// Незакрытые заявки текущего офиса (для ленты и «Под заявки»).
export async function loadPendingOrders(officeId) {
  if (!supabase || !MANAGER_ORDERS_ENABLED) return [];
  let q = supabase
    .from("manager_orders")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (officeId) q = q.eq("office_id", officeId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(mapOrder);
}

export async function createOrder(payload) {
  if (!supabase) throw new Error("Supabase не настроен");
  const row = {
    office_id: payload.officeId || null,
    kind: payload.kind || "exchange",
    contact: payload.contact || null,
    client_id: payload.clientId || null,
    from_currency: payload.fromCurrency || null,
    from_amount: payload.fromAmount ?? null,
    rate: payload.rate || null,
    to_currency: payload.toCurrency || null,
    to_amount: payload.toAmount ?? null,
    // Заявкам из кассы тоже присваиваем код (если не передан внешний).
    meeting_code: payload.meetingCode || genOrderCode(),
    meeting_at: payload.meetingAt || null,
  };
  const { data, error } = await supabase
    .from("manager_orders")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error; // честный fail
  return mapOrder(data);
}

// Переключаемая отметка «клиент пришёл» (вкл = ставим время, выкл = снимаем).
export async function setArrived(id, arrived) {
  if (!supabase) return;
  const { error } = await supabase
    .from("manager_orders")
    .update({ arrived_at: arrived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

// Идемпотентно: UPDATE только из 'pending' → повторное «провести» не дублирует.
export async function markDone(id, { dealId, note } = {}) {
  if (!supabase) return;
  const patch = { status: "done" };
  if (dealId != null) patch.deal_id = dealId;
  if (note) patch.note = note;
  const { error } = await supabase
    .from("manager_orders")
    .update(patch)
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw error;
}

// Править заявку по факту (когда клиент пришёл — суммы/курс/контакт могут
// измениться). Принимает camelCase-патч, шлёт только переданные поля.
export async function updateOrder(id, patch = {}) {
  if (!supabase) return;
  const map = {
    contact: "contact",
    clientId: "client_id",
    fromCurrency: "from_currency",
    fromAmount: "from_amount",
    rate: "rate",
    toCurrency: "to_currency",
    toAmount: "to_amount",
    meetingCode: "meeting_code",
    note: "note",
  };
  const row = {};
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) row[col] = patch[k] === "" ? null : patch[k];
  }
  if (!Object.keys(row).length) return;
  const { error } = await supabase.from("manager_orders").update(row).eq("id", id);
  if (error) throw error;
}

export async function cancelOrder(id) {
  if (!supabase) return;
  const { error } = await supabase
    .from("manager_orders")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) throw error;
}

// Realtime-подписка. Уникальное имя канала на каждую подписку — иначе два
// подписчика (лента + остатки) с одним именем дают «cannot add postgres_changes
// callbacks after subscribe()». Возвращает unsubscribe.
let _chSeq = 0;
export function subscribeOrders(onChange) {
  if (!supabase || !MANAGER_ORDERS_ENABLED) return () => {};
  _chSeq += 1;
  const ch = supabase
    .channel(`manager-orders-${_chSeq}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "manager_orders" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(ch);
}
