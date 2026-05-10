// src/lib/treasury/v2selectors.js
// Pure-function selectors for Treasury Spec B. Take a `ctx` object built up
// from useLedger() + useBaseCurrency(): { accounts, balances, transactions,
// entries, toBase, baseCurrency, officeFilter, now? }.
// All office filtering happens here. "all" includes office_id IS NULL accounts;
// a specific office UUID excludes them.

function passesOfficeFilter(account, officeFilter) {
  if (officeFilter === "all" || !officeFilter) return true;
  return account.officeId === officeFilter;
}

const SUBTYPE_LABEL_KEYS = {
  cash: "trv2_subtype_cash",
  bank: "trv2_subtype_bank",
  crypto_input: "trv2_subtype_crypto_input",
  crypto_output: "trv2_subtype_crypto_output",
  inter_office: "trv2_subtype_inter_office",
  clearing: "trv2_subtype_clearing",
  fx_clearing: "trv2_subtype_fx_clearing",
  customer_liab: "trv2_subtype_customer_liab",
  partner_liab: "trv2_subtype_partner_liab",
  unearned: "trv2_subtype_unearned",
  opening_balance: "trv2_subtype_opening_balance",
  retained_earnings: "trv2_subtype_retained_earnings",
  owner_contribution: "trv2_subtype_owner_contribution",
  spread: "trv2_subtype_spread",
  commission: "trv2_subtype_commission",
  fx_gain: "trv2_subtype_fx_gain",
  fx_loss: "trv2_subtype_fx_loss",
  network_fee: "trv2_subtype_network_fee",
  exchange_fee: "trv2_subtype_exchange_fee",
};

export function groupByClass(ctx, accountType) {
  const { accounts, balances, toBase, officeFilter } = ctx;
  // balance lookup: (accountId, currency, clientId, partnerId) → balance
  const balByKey = new Map();
  for (const b of balances) {
    balByKey.set(`${b.accountId}|${b.currency}|${b.clientId || ""}|${b.partnerId || ""}`, b);
  }
  const bySubtype = new Map();
  for (const acc of accounts) {
    if (acc.type !== accountType) continue;
    if (!passesOfficeFilter(acc, officeFilter)) continue;
    // an account may have multiple balance rows (per dimension) — emit one row per
    const rowsForAccount = balances.filter((b) => b.accountId === acc.id);
    const dimRows = rowsForAccount.length > 0 ? rowsForAccount : [{ accountId: acc.id, currency: acc.currency, clientId: null, partnerId: null, balance: 0 }];
    const subtype = acc.subtype || "other";
    const sect = bySubtype.get(subtype) || { subtype, labelKey: SUBTYPE_LABEL_KEYS[subtype] || "trv2_subtype_other", accounts: [], totalInBase: 0 };
    for (const dr of dimRows) {
      const inBase = toBase(dr.balance, dr.currency) || 0;
      sect.accounts.push({
        accountId: acc.id, code: acc.code, name: acc.name, currency: dr.currency,
        clientId: dr.clientId || null, partnerId: dr.partnerId || null,
        balance: dr.balance, balanceInBase: inBase,
      });
      sect.totalInBase += inBase;
    }
    bySubtype.set(subtype, sect);
  }
  return [...bySubtype.values()].sort((a, b) => b.totalInBase - a.totalInBase);
}

export function accountEntries(ctx, accountId, limit = 50) {
  const { entries, transactions } = ctx;
  const txById = new Map(transactions.map((t) => [t.id, t]));
  return entries
    .filter((e) => e.accountId === accountId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map((e) => {
      const tx = txById.get(e.transactionId);
      return {
        id: e.id,
        createdAt: e.createdAt,
        direction: e.direction,
        amount: e.amount,
        currency: e.currency,
        clientId: e.clientId || null,
        partnerId: e.partnerId || null,
        note: e.note || "",
        txId: e.transactionId,
        txKind: tx ? tx.kind : "unknown",
        sourceRefId: tx ? tx.sourceRefId : null,
      };
    });
}

export function transactionTree(ctx, opts = {}) {
  const { transactions, entries, accounts } = ctx;
  const { type = "all", officeFilter = "all", period } = opts;
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const entriesByTx = new Map();
  for (const e of entries) {
    const arr = entriesByTx.get(e.transactionId) || [];
    arr.push(e);
    entriesByTx.set(e.transactionId, arr);
  }
  const fromMs = period ? new Date(period.from).getTime() : -Infinity;
  const toMs = period ? new Date(period.to).getTime() : Infinity;

  return transactions
    .filter((t) => {
      if (type !== "all" && t.kind !== type) return false;
      const ts = new Date(t.effectiveDate).getTime();
      if (ts < fromMs || ts > toMs) return false;
      if (officeFilter !== "all" && officeFilter) {
        // keep if any entry touches an account with this officeId
        const txEntries = entriesByTx.get(t.id) || [];
        const touches = txEntries.some((e) => accById.get(e.accountId)?.officeId === officeFilter);
        if (!touches) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate))
    .map((t) => ({
      tx: t,
      entries: (entriesByTx.get(t.id) || []).map((e) => ({
        ...e,
        accountCode: accById.get(e.accountId)?.code || "?",
        accountName: accById.get(e.accountId)?.name || "?",
      })),
    }));
}
