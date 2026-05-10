// src/lib/treasury/pnlCompare.js
// Pure helpers for the P&L tab's "compare with previous period" mode and CSV export.
// No React, no Supabase. Account shape (from pnlForPeriod): { code, name, currency, amountInBase, entryCount }.

// Merge a section's current-period accounts with the previous-period accounts, keyed by code.
// Returns rows { code, name, currency, entryCount, amountInBase, prevInBase, delta }, one per code
// appearing in either side. name/currency/entryCount come from the current row if present, else the prev row.
// Sorted by |amountInBase| desc, then code asc.
export function mergePnlSection(currentAccounts, prevAccounts) {
  const cur = currentAccounts || [];
  const prev = prevAccounts || [];
  const prevByCode = new Map(prev.map((a) => [a.code, a]));
  const curByCode = new Map(cur.map((a) => [a.code, a]));
  const codes = new Set([...curByCode.keys(), ...prevByCode.keys()]);
  const rows = [...codes].map((code) => {
    const c = curByCode.get(code) || null;
    const p = prevByCode.get(code) || null;
    const src = c || p;
    const amountInBase = c ? Number(c.amountInBase) || 0 : 0;
    const prevInBase = p ? Number(p.amountInBase) || 0 : 0;
    return {
      code,
      name: src.name,
      currency: src.currency,
      entryCount: c ? c.entryCount : (p ? p.entryCount : 0),
      amountInBase,
      prevInBase,
      delta: amountInBase - prevInBase,
    };
  });
  rows.sort((a, b) => {
    const d = Math.abs(b.amountInBase) - Math.abs(a.amountInBase);
    return d !== 0 ? d : String(a.code).localeCompare(String(b.code));
  });
  return rows;
}

const PNL_SECTIONS = [
  ["revenue", (p) => p.revenue.accounts],
  ["expense", (p) => p.expense.accounts],
  ["fx", (p) => p.fxAccounts],
];

// Flat CSV rows for the current P&L (and previous, if pnlPrev given): one row per account across
// revenue/expense/fx sections, then a net_profit row. With pnlPrev, each row gets amountPrev + delta.
export function csvRowsForPnl(pnl, pnlPrev) {
  const rows = [];
  for (const [section, pick] of PNL_SECTIONS) {
    const curAccts = pick(pnl) || [];
    if (pnlPrev) {
      const merged = mergePnlSection(curAccts, pick(pnlPrev) || []);
      for (const r of merged) {
        rows.push({ section, code: r.code, name: r.name, currency: r.currency, amount: r.amountInBase, entryCount: r.entryCount, amountPrev: r.prevInBase, delta: r.delta });
      }
    } else {
      for (const a of curAccts) {
        rows.push({ section, code: a.code, name: a.name, currency: a.currency, amount: Number(a.amountInBase) || 0, entryCount: a.entryCount });
      }
    }
  }
  const np = { section: "net_profit", code: "", name: "", currency: "", amount: Number(pnl.netProfit) || 0, entryCount: "" };
  if (pnlPrev) { np.amountPrev = Number(pnlPrev.netProfit) || 0; np.delta = np.amount - np.amountPrev; }
  rows.push(np);
  return rows;
}
