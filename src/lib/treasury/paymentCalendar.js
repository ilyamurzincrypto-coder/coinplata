// src/lib/treasury/paymentCalendar.js
// Pure helpers for the payment calendar: bucket open obligations (deferred deal
// legs we still owe) by their due date. Source rows come from operations.v_open_deals
// (via useOpenObligations): { id, status, due_date, open_legs[], counterparty_name,
// open_count, pending_out_total, office_id, ledger_tx_id, ... }.

const DAY_MS = 24 * 3600 * 1000;

function startOfLocalDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Bucket order: overdue → today → next 7 days → later → no due date.
export const PC_BUCKETS = ["overdue", "today", "week", "later", "no_date"];

export function bucketObligations(items, nowMs = Date.now()) {
  const today0 = startOfLocalDay(nowMs);
  const tomorrow0 = today0 + DAY_MS;
  const week0 = today0 + 7 * DAY_MS;
  const out = { overdue: [], today: [], week: [], later: [], no_date: [] };
  for (const it of items || []) {
    if (!it.due_date) { out.no_date.push(it); continue; }
    const d = new Date(it.due_date).getTime();
    if (!Number.isFinite(d)) { out.no_date.push(it); continue; }
    if (d < today0) out.overdue.push(it);
    else if (d < tomorrow0) out.today.push(it);
    else if (d < week0) out.week.push(it);
    else out.later.push(it);
  }
  for (const k of ["overdue", "today", "week", "later"]) {
    out[k].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  }
  return out;
}

// Per-currency totals of the open legs in a single obligation row.
// `open_legs` is a jsonb array of { currency, amount, ... }. Returns [{ currency, amount }] sorted.
export function obligationLegTotals(item) {
  const byCur = new Map();
  for (const l of item?.open_legs || []) {
    const cur = l.currency || "?";
    byCur.set(cur, (byCur.get(cur) || 0) + (Number(l.amount) || 0));
  }
  return [...byCur.entries()].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => a.currency.localeCompare(b.currency));
}
