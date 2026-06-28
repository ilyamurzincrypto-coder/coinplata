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
    .select("id, created_at, effective_date, status, source_kind, metadata")
    .in("source_kind", ["deal", "topup", "withdrawal"])
    .order("effective_date", { ascending: true });
  if (fromIso) q = q.gte("effective_date", fromIso);
  const { data: txs, error } = await q;
  if (error) throw error;

  // Сделки + одноногие кассовые (topup/withdrawal с cashier_one_leg). Проведённые,
  // офис — по metadata.
  const posted = (txs || []).filter(
    (t) =>
      t.status === "posted" &&
      (t.source_kind === "deal" || t.metadata?.cashier_one_leg) &&
      (!officeId || t.metadata?.office_id === officeId)
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
    .select("transaction_id, direction, amount, currency_code, note, client_id")
    .in("transaction_id", ids);
  if (e2) throw e2;

  const byTx = {};
  (legs || []).forEach((l) => {
    (byTx[l.transaction_id] || (byTx[l.transaction_id] = [])).push(l);
  });

  // Открытые отложенные ноги расхода («мы должны») — из operations.v_open_deals.
  // Если сделки там нет → нога закрыта (рассчитались).
  let openSet = new Set();
  try {
    const { data: open } = await supabase
      .schema("operations")
      .from("v_open_deals")
      .select("ledger_tx_id");
    openSet = new Set((open || []).map((o) => o.ledger_tx_id));
  } catch {
    /* вьюхи может не быть в exposed-schemas — бейдж просто будет «открыт» */
  }

  return active.map((t) => {
    const m = t.metadata || {};
    // Одноногая (topup/withdrawal): реконструируем из метаданных, без леги-нот.
    if (m.cashier_one_leg) {
      const ccy = String(m.deferred_currency || "").toUpperCase();
      const amt = Number(m.deferred_amount) || 0;
      const isIn = m.phys_side === "in";
      return {
        id: t.id,
        clientId: m.client_id || null,
        party: m.client_nickname || "—",
        inCcy: isIn ? ccy : "",
        inAmount: isIn ? amt : 0,
        rate: null,
        outs: isIn ? [] : [{ ccy, amount: amt }],
        createdAt: t.effective_date || t.created_at,
        confirmed: !!m.confirmed_at,
        deferred: {
          oneLeg: true,
          side: m.deferred_side,
          currency: ccy,
          amount: amt,
          dueDate: m.due_date || null,
          comment: m.obligation_comment || null,
          open: true, // точный статус — в сводке «Незавершённое»
        },
      };
    }
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
    const clientId = (L.find((l) => l.client_id) || {}).client_id || null;
    return {
      id: t.id,
      clientId,
      party: t.metadata?.client_nickname || "—",
      inCcy,
      inAmount,
      rate,
      outs,
      createdAt: t.effective_date || t.created_at,
      // Подтверждение бухгалтера (Казначейство → «Подтвердить»). Зелёная, если сверено.
      confirmed: !!t.metadata?.confirmed_at,
      // Отложенная сделка (долг): сторона/сумма/дата/коммент — для бейджа.
      deferred: t.metadata?.deferred_side
        ? {
            side: t.metadata.deferred_side, // 'in' = клиент должен нам, 'out' = мы должны
            currency: String(t.metadata.deferred_currency || "").toUpperCase(),
            amount: Number(t.metadata.deferred_amount) || 0,
            dueDate: t.metadata.due_date || t.metadata.planned_at || null,
            comment: t.metadata.obligation_comment || null,
            // Открыт ли долг. Для «мы должны» (out) — по v_open_deals; для «клиент
            // должен» (in) точного per-сделочного признака пока нет → считаем открытым.
            open: t.metadata.deferred_side === "out" ? openSet.has(t.id) : true,
          }
        : null,
    };
  });
}

// Сводка незавершённых обязательств (долги) — для витрины «Незавершённое».
// Источник: отложенные сделки (со сторонами/датами/комментами) за широкое окно,
// статус открытости: out → v_open_deals; in → баланс клиента по валюте < 0.
export async function loadOpenObligations({ officeId, sinceIso } = {}) {
  if (!supabase) return { weOwe: [], theyOwe: [] };

  let q = lg()
    .from("transactions")
    .select("id, effective_date, status, source_kind, metadata")
    .in("source_kind", ["deal", "topup", "withdrawal"])
    .order("effective_date", { ascending: true });
  if (sinceIso) q = q.gte("effective_date", sinceIso);
  const { data: txs, error } = await q;
  if (error) throw error;

  const deferred = (txs || []).filter(
    (t) =>
      t.status === "posted" &&
      t.metadata?.deferred_side &&
      (!officeId || t.metadata?.office_id === officeId)
  );
  if (!deferred.length) return { weOwe: [], theyOwe: [] };

  // Исключаем сторнированные.
  const ids = deferred.map((t) => t.id);
  const { data: revs } = await lg()
    .from("transactions")
    .select("reverses_transaction_id")
    .in("reverses_transaction_id", ids);
  const reversed = new Set((revs || []).map((r) => r.reverses_transaction_id));

  // Открытость out-ноги.
  let openSet = new Set();
  try {
    const { data: open } = await supabase.schema("operations").from("v_open_deals").select("ledger_tx_id");
    openSet = new Set((open || []).map((o) => o.ledger_tx_id));
  } catch {
    /* нет вьюхи — считаем открытыми */
  }
  // Балансы клиентов: <0 — клиент должен нам; >0 — мы должны клиенту.
  const negByClientCcy = new Set();
  const posByClientCcy = new Set();
  try {
    const { data: bals } = await lg().from("v_client_balances").select("client_id, currency_code, balance");
    (bals || []).forEach((b) => {
      const key = `${b.client_id}|${String(b.currency_code).toUpperCase()}`;
      if (Number(b.balance) < 0) negByClientCcy.add(key);
      else if (Number(b.balance) > 0) posByClientCcy.add(key);
    });
  } catch {
    /* нет вьюхи */
  }

  const weOwe = [];
  const theyOwe = [];
  for (const t of deferred) {
    if (reversed.has(t.id)) continue;
    const m = t.metadata;
    const side = m.deferred_side;
    const currency = String(m.deferred_currency || "").toUpperCase();
    const clientId = m.client_id || null;
    const key = `${clientId}|${currency}`;
    let open;
    if (m.cashier_one_leg) {
      // одноногая: открыта, пока баланс клиента не погашен.
      open = side === "out" ? posByClientCcy.has(key) : negByClientCcy.has(key);
    } else {
      open = side === "out" ? openSet.has(t.id) : !clientId || negByClientCcy.has(key);
    }
    if (!open) continue;
    const item = {
      dealId: t.id,
      party: m.client_nickname || "—",
      currency,
      amount: Number(m.deferred_amount) || 0,
      dueDate: m.due_date || m.planned_at || null,
      comment: m.obligation_comment || null,
    };
    (side === "out" ? weOwe : theyOwe).push(item);
  }
  return { weOwe, theyOwe };
}
