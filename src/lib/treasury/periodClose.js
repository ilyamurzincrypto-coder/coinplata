// src/lib/treasury/periodClose.js
// Compute the lines for a period close: fold every non-zero revenue/expense
// account balance into the per-currency Retained Earnings. Pure — the caller
// posts each line via ledger.create_adjustment('reconciliation', …).

// ctx — { accounts: [{ id, code, name, type, currency, ... }], balances: [{ accountId, balance, ... }] }
// Returns { lines, netByCurrency }:
//   lines  — [{ accountCode, accountName, currency, kind: "revenue"|"expense", balance, amount }]
//            `amount` is the delta to pass to create_adjustment('reconciliation', …):
//              revenue (Cr-normal, balance B)  → +B  ⇒ Dr <revenue> B / Cr RE[cur] B  (zeros revenue, RE up)
//              expense (Dr-normal, balance B)  → −B  ⇒ Cr <expense> B / Dr RE[cur] B  (zeros expense, RE down)
//   netByCurrency — { [cur]: Σ revenue.balance − Σ expense.balance }  (= period net profit per currency)
// Accounts whose balance is ~0 are skipped. Empty `lines` ⇒ nothing to close.
export function periodCloseLines(ctx) {
  const accounts = ctx?.accounts || [];
  const balances = ctx?.balances || [];
  const balByAcc = new Map();
  for (const b of balances) balByAcc.set(b.accountId, (balByAcc.get(b.accountId) || 0) + Number(b.balance || 0));

  const EPS = 1e-9;
  const lines = [];
  const netByCurrency = {};
  for (const a of accounts) {
    if (a.type !== "revenue" && a.type !== "expense") continue;
    const balance = balByAcc.get(a.id) || 0;
    if (Math.abs(balance) < EPS) continue;
    const cur = a.currency;
    lines.push({
      accountCode: a.code,
      accountName: a.name,
      currency: cur,
      kind: a.type,
      balance,
      amount: a.type === "revenue" ? balance : -balance,
    });
    netByCurrency[cur] = (netByCurrency[cur] || 0) + (a.type === "revenue" ? balance : -balance);
  }
  // Stable order: revenue first, then expense, by code.
  lines.sort((x, y) => (x.kind === y.kind ? String(x.accountCode).localeCompare(String(y.accountCode)) : x.kind === "revenue" ? -1 : 1));
  return { lines, netByCurrency };
}
