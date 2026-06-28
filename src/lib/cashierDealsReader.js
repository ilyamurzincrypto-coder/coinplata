// src/lib/cashierDealsReader.js
// Чтение сделок за день для кассирского леджера (Зона C).
//
// ВАЖНО: сделки создаются через v2-леджер (create_deal_v2) и живут в
// ledger.transactions(source_kind='deal') + ledger.journal_entries — НЕ в
// public.deals (та заморожена). Поэтому читаем из ledger:
//   • приход (что клиент дал нам)  = нога note ~ '^IN:'  & direction='dr'
//   • расход (что мы выдали)       = ноги note ~ '^OUT:' & direction='cr'
//   • контрагент / office_id       = transactions.metadata
// Реконструкция сверена с реальными проводками create_deal_v2.

import { supabase } from "./supabase.js";

const lg = () => supabase.schema("ledger");

export async function loadCashierDeals({ officeId, fromIso } = {}) {
  if (!supabase) return [];

  // Время сделки для кассы — effective_date (когда сделка произошла; create_deal_v2
  // ставит её из поля «Время», по умолчанию now). Фильтр дня — тоже по нему.
  let q = lg()
    .from("transactions")
    .select("id, created_at, effective_date, status, metadata")
    .eq("source_kind", "deal")
    .order("effective_date", { ascending: true });
  if (fromIso) q = q.gte("effective_date", fromIso);
  const { data: txs, error } = await q;
  if (error) throw error;

  // Только проведённые; офис фильтруем по metadata (надёжнее jsonb-фильтра PostgREST).
  const posted = (txs || []).filter(
    (t) => t.status === "posted" && (!officeId || t.metadata?.office_id === officeId)
  );
  if (!posted.length) return [];

  // Сторно: сделка считается удалённой, если есть транзакция, реверсящая её
  // (reverses_transaction_id = id сделки). Такие исключаем из ленты.
  const postedIds = posted.map((t) => t.id);
  const { data: revs } = await lg()
    .from("transactions")
    .select("reverses_transaction_id")
    .in("reverses_transaction_id", postedIds);
  const reversed = new Set((revs || []).map((r) => r.reverses_transaction_id));
  const active = posted.filter((t) => !reversed.has(t.id));
  const ids = active.map((t) => t.id);
  if (!ids.length) return [];

  const { data: legs, error: e2 } = await lg()
    .from("journal_entries")
    .select("transaction_id, direction, amount, currency_code, note")
    .in("transaction_id", ids);
  if (e2) throw e2;

  const byTx = {};
  (legs || []).forEach((l) => {
    (byTx[l.transaction_id] || (byTx[l.transaction_id] = [])).push(l);
  });

  return active.map((t) => {
    const L = byTx[t.id] || [];
    const inLeg = L.find((l) => /^IN:/.test(l.note || "") && l.direction === "dr");
    const outLegs = L.filter((l) => /^OUT:/.test(l.note || "") && l.direction === "cr");
    const inCcy = String(inLeg?.currency_code || "").toUpperCase();
    const inAmount = Number(inLeg?.amount) || 0;
    const outs = outLegs.map((l) => ({
      ccy: String(l.currency_code || "").toUpperCase(),
      amount: Number(l.amount) || 0,
    }));
    const outTotal = outs.reduce((s, o) => s + o.amount, 0);
    const rate = inAmount > 0 && outTotal > 0 ? outTotal / inAmount : null;
    return {
      id: t.id,
      party: t.metadata?.client_nickname || "—",
      inCcy,
      inAmount,
      rate,
      outs,
      createdAt: t.effective_date || t.created_at,
      // Подтверждение бухгалтера (Казначейство → «Подтвердить»). Зелёная, если сверено.
      confirmed: !!t.metadata?.confirmed_at,
    };
  });
}
