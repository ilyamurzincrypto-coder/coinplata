// src/lib/treasury/dealSummary.js
// Derive a short "exchange summary" of a v2 deal transaction from its journal
// entries — what came in, what went out, and our margin — for display in the
// Cashier's transactions list. Pure: no i18n, no formatting (the caller turns the
// returned structure into a localised string).

// node    — a transactionTree node: { tx, entries: [{ accountId, direction:'dr'|'cr',
//                                       amount, currency, accountCode, accountName }] }
// accById — Map<accountId, { type: 'asset'|'liability'|'equity'|'revenue'|'expense', ... }>
//
// Returns { in: [{ amount, currency, accountName }],
//           out: [{ amount, currency, accountName }],
//           margin: [{ amount, currency }] }
//   in     — asset accounts whose net is on the debit side (money received)
//   out    — asset accounts whose net is on the credit side (money paid out), `amount` positive
//   margin — revenue accounts' net credit (the spread / commission)
// …or `null` when there's nothing meaningful to summarise (no asset legs at all).
export function dealSummary(node, accById) {
  const entries = node?.entries || [];
  if (entries.length === 0) return null;

  // net = Σ Dr − Σ Cr per (accountId, currency); also keep a representative name.
  const net = new Map(); // key `${accountId}|${currency}` -> { accountId, currency, accountName, value }
  for (const e of entries) {
    const key = `${e.accountId}|${e.currency}`;
    const rec = net.get(key) || { accountId: e.accountId, currency: e.currency, accountName: e.accountName || "?", value: 0 };
    rec.value += (e.direction === "dr" ? 1 : -1) * Number(e.amount || 0);
    net.set(key, rec);
  }

  const inLegs = [], outLegs = [], margin = [];
  const EPS = 1e-9;
  for (const rec of net.values()) {
    const acc = accById?.get(rec.accountId);
    const type = acc?.type;
    if (type === "asset") {
      if (rec.value > EPS) inLegs.push({ amount: rec.value, currency: rec.currency, accountName: rec.accountName });
      else if (rec.value < -EPS) outLegs.push({ amount: -rec.value, currency: rec.currency, accountName: rec.accountName });
    } else if (type === "revenue") {
      // revenue is credit-normal: a net credit (value < 0) is the earned amount.
      if (rec.value < -EPS) margin.push({ amount: -rec.value, currency: rec.currency });
    }
    // liability/equity/expense legs are not part of the headline summary.
  }
  if (inLegs.length === 0 && outLegs.length === 0) return null;
  return { in: inLegs, out: outLegs, margin };
}
