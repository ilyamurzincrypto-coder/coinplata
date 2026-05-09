// src/lib/treasury/selectors.js
// Pure-function selectors for Treasury Dashboard MVP.
//
// Each takes a `ctx` object built up from hook outputs:
//   { officeId, accounts, movements, obligations, transactions,
//     rates, lastConfirmedAt, modifiedAfterConfirmation,
//     balanceOf, reservedOf, toBase, baseCurrency, now? }
//
// All filtering by officeId happens here so subcomponents stay dumb.
// `now` is optional injectable Date factory for tests; defaults to Date.now.

export function groupByCurrency(ctx) {
  const { officeId, accounts, balanceOf, reservedOf, toBase } = ctx;
  const officeAccounts = accounts.filter((a) => a.officeId === officeId);
  const byCcy = new Map();
  for (const a of officeAccounts) {
    const ccy = String(a.currency || a.currency_code || "").toUpperCase();
    if (!ccy) continue;
    const total = balanceOf(a.id) || 0;
    const reserved = reservedOf(a.id) || 0;
    const available = total - reserved;
    const totalInBase = toBase(total, ccy) || 0;
    const row = byCcy.get(ccy) || { currency: ccy, available: 0, reserved: 0, total: 0, totalInBase: 0 };
    row.available += available;
    row.reserved += reserved;
    row.total += total;
    row.totalInBase += totalInBase;
    byCcy.set(ccy, row);
  }
  return [...byCcy.values()].sort((x, y) => y.totalInBase - x.totalInBase);
}
