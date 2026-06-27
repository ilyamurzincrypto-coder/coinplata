// src/lib/cashierDealsReader.js
// Чтение сделок за день для кассирского леджера (Зона C). Читаем напрямую из
// deals + deal_legs (RLS включён, realtime на обеих). Сделка = 1 приход
// (deals.currency_in/amount_in) + N легов расхода (deal_legs). verify-first:
// поля сверены со схемой, ничего не выдумываем.

import { supabase } from "./supabase.js";

export async function loadCashierDeals({ officeId, fromIso } = {}) {
  if (!supabase) return [];
  let q = supabase
    .from("deals")
    .select("id, client_nickname, currency_in, amount_in, created_at, office_id")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (officeId) q = q.eq("office_id", officeId);
  if (fromIso) q = q.gte("created_at", fromIso);
  const { data: deals, error } = await q;
  if (error) throw error;

  const ids = (deals || []).map((d) => d.id);
  const legsByDeal = {};
  if (ids.length) {
    const { data: legs, error: e2 } = await supabase
      .from("deal_legs")
      .select("deal_id, currency, amount, rate, leg_index")
      .in("deal_id", ids)
      .order("leg_index", { ascending: true });
    if (e2) throw e2;
    (legs || []).forEach((l) => {
      (legsByDeal[l.deal_id] || (legsByDeal[l.deal_id] = [])).push(l);
    });
  }

  return (deals || []).map((d) => {
    const outs = (legsByDeal[d.id] || []).map((l) => ({
      ccy: String(l.currency || "").toUpperCase(),
      amount: Number(l.amount) || 0,
    }));
    const rate = (legsByDeal[d.id] || [])[0]?.rate;
    return {
      id: d.id,
      party: d.client_nickname || "—",
      inCcy: String(d.currency_in || "").toUpperCase(),
      inAmount: Number(d.amount_in) || 0,
      rate: rate != null ? Number(rate) : null,
      outs,
      createdAt: d.created_at,
    };
  });
}
