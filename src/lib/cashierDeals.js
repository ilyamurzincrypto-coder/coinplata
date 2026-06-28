// src/lib/cashierDeals.js
// Черновики сделок кассира (public.cashier_deals). Кассир записывает сделку →
// ЧЕРНОВИК (без проводок). Бухгалтер подтверждает → create_deal_v2 (проводки) +
// ledger_tx_id + status='confirmed'. Удаление: черновик — физически; подтверждённая
// — сторно (reverse_transaction) + status='cancelled'.

import { supabase } from "./supabase.js";

function mapRow(r) {
  const outCcy = (r.out_currency || "").toUpperCase();
  return {
    id: r.id,
    status: r.status, // draft | confirmed | cancelled
    confirmed: r.status === "confirmed",
    party: r.party_label || "—",
    clientId: r.client_id || null,
    inCcy: (r.in_currency || "").toUpperCase(),
    inAmount: Number(r.in_amount) || 0,
    rate: r.rate != null ? Number(r.rate) : null,
    outCcy,
    outAmount: Number(r.out_amount) || 0,
    outs: outCcy ? [{ ccy: outCcy, amount: Number(r.out_amount) || 0 }] : [],
    createdAt: r.effective_at || r.created_at,
    ledgerTxId: r.ledger_tx_id || null,
  };
}

// Сделки дня офиса (черновики + подтверждённые; отменённые скрыты).
export async function loadCashierDealDrafts({ officeId, fromIso } = {}) {
  if (!supabase) return [];
  let q = supabase
    .from("cashier_deals")
    .select("*")
    .neq("status", "cancelled")
    .order("effective_at", { ascending: true });
  if (officeId) q = q.eq("office_id", officeId);
  if (fromIso) q = q.gte("effective_at", fromIso);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function createDealDraft(p) {
  if (!supabase) throw new Error("Supabase не настроен");
  const row = {
    office_id: p.officeId || null,
    party_label: p.partyLabel || null,
    client_id: p.clientId || null,
    in_currency: p.inCurrency || null,
    in_amount: p.inAmount ?? null,
    rate: p.rate || null,
    out_currency: p.outCurrency || null,
    out_amount: p.outAmount ?? null,
    effective_at: p.effectiveAt || null,
  };
  const { data, error } = await supabase.from("cashier_deals").insert(row).select("*").single();
  if (error) throw error;
  return mapRow(data);
}

// Пометить черновик подтверждённым (после успешного create_deal_v2). Идемпотентно
// по status='draft'.
export async function markDealConfirmed(id, ledgerTxId, confirmedBy) {
  if (!supabase) return;
  const { error } = await supabase
    .from("cashier_deals")
    .update({
      status: "confirmed",
      ledger_tx_id: ledgerTxId || null,
      confirmed_by: confirmedBy || null,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "draft");
  if (error) throw error;
}

// Черновик (проводок не было) — удаляем физически.
export async function deleteDealDraft(id) {
  if (!supabase) return;
  const { error } = await supabase.from("cashier_deals").delete().eq("id", id).eq("status", "draft");
  if (error) throw error;
}

// Подтверждённую — помечаем cancelled (сторно делает вызывающий по ledger_tx_id).
export async function markDealCancelled(id) {
  if (!supabase) return;
  const { error } = await supabase.from("cashier_deals").update({ status: "cancelled" }).eq("id", id);
  if (error) throw error;
}

let _chSeq = 0;
export function subscribeCashierDeals(onChange) {
  if (!supabase) return () => {};
  _chSeq += 1;
  const ch = supabase
    .channel(`cashier-deals-drafts-${_chSeq}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "cashier_deals" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(ch);
}
