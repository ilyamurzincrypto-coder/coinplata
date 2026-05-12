// src/lib/treasury/dealSummary.js
// Derive a short "exchange summary" of a v2 deal transaction from its journal
// entries — what came in, what went out, and our margin — for display in the
// Cashier's transactions list. Pure: no i18n, no formatting (the caller turns the
// returned structure into a localised string).

// node    — a transactionTree node: { tx, entries: [{ accountId, direction:'dr'|'cr',
//                                       amount, currency, accountCode, accountName }] }
// accById — Map<accountId, { type: 'asset'|'liability'|'equity'|'revenue'|'expense',
//                            subtype?: 'cash'|'customer_liab'|'unearned'|'fx_clearing'|… }>
//
// Returns { in:  [{ amount, currency, accountName, deferred?: true }],
//           out: [{ amount, currency, accountName, deferred?: true }],
//           margin: [{ amount, currency }] }
//   in      — money received: asset accounts net on the debit side, plus a net debit on a
//             counterparty's liability (their balance with us went down → they funded the deal)
//   out     — money paid out: asset accounts net on the credit side, plus a net credit on a
//             counterparty's liability — that's an OBLIGATION not yet paid (`deferred: true`)
//   margin  — our spread/commission: revenue net credit, plus `unearned` net credit (deferred)
//   deferred — set when the leg is a counterparty's liability balance, not a real cash move
// …or `null` when there's nothing meaningful to summarise (no in/out legs at all).
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
    const subtype = acc?.subtype || null;
    if (type === "asset") {
      if (rec.value > EPS) inLegs.push({ amount: rec.value, currency: rec.currency, accountName: rec.accountName });
      else if (rec.value < -EPS) outLegs.push({ amount: -rec.value, currency: rec.currency, accountName: rec.accountName });
    } else if (type === "liability" && (subtype === "customer_liab" || subtype === "partner_liab")) {
      // The counterparty's running balance with us. A net CREDIT = we owe them more = an
      // obligation we still have to pay out ("ушло, к выдаче"). A net DEBIT = their balance
      // went down (they funded the deal from it) = money in for this deal.
      if (rec.value < -EPS) outLegs.push({ amount: -rec.value, currency: rec.currency, accountName: rec.accountName, deferred: true });
      else if (rec.value > EPS) inLegs.push({ amount: rec.value, currency: rec.currency, accountName: rec.accountName, deferred: true });
    } else if (type === "revenue" || (type === "liability" && subtype === "unearned")) {
      // Our spread / commission — earned (revenue) or deferred-earned (`unearned`). Both
      // credit-normal: a net credit (value < 0) is the amount earned.
      if (rec.value < -EPS) margin.push({ amount: -rec.value, currency: rec.currency });
    }
    // equity (fx_clearing) and expense legs are not part of the headline summary.
  }
  if (inLegs.length === 0 && outLegs.length === 0) return null;
  return { in: inLegs, out: outLegs, margin };
}

// Σ amounts by currency for a list of {currency, amount} legs → [{currency, amount}].
function sumByCurrency(legs) {
  const m = new Map();
  for (const l of legs || []) m.set(l.currency, (m.get(l.currency) || 0) + Number(l.amount || 0));
  return [...m.entries()].map(([currency, amount]) => ({ currency, amount }));
}

// Headline exchange rate of a deal — OUT per IN (e.g. USD→TRY ⇒ 45) — but only when the
// deal is a clean one-currency-in ↔ one-currency-out exchange. Returns { rate, from, to }
// or null. `s` is a dealSummary() result (or null). Pure: no formatting.
export function dealRate(s) {
  if (!s) return null;
  const ins = sumByCurrency(s.in), outs = sumByCurrency(s.out);
  if (ins.length !== 1 || outs.length !== 1) return null;
  if (ins[0].currency === outs[0].currency) return null;
  if (!(ins[0].amount > 0) || !(outs[0].amount > 0)) return null;
  return { rate: outs[0].amount / ins[0].amount, from: ins[0].currency, to: outs[0].currency };
}
