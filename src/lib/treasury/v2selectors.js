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

export function accountEntries(ctx, accountId, limit = 50, period = null) {
  const { entries, transactions } = ctx;
  const txById = new Map(transactions.map((t) => [t.id, t]));
  const fromMs = period ? new Date(period.from).getTime() : -Infinity;
  const toMs = period ? new Date(period.to).getTime() : Infinity;
  return entries
    .filter((e) => e.accountId === accountId)
    .filter((e) => {
      if (!period) return true;
      const tx = txById.get(e.transactionId);
      const ts = tx ? new Date(tx.effectiveDate).getTime() : new Date(e.createdAt).getTime();
      return ts >= fromMs && ts <= toMs;
    })
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
      // "reversal" isn't a source_kind — a reversing tx carries the original kind +
      // a non-null reversesTransactionId. All other types match on kind directly.
      if (type === "reversal") {
        if (!t.reversesTransactionId) return false;
      } else if (type !== "all" && t.kind !== type) {
        return false;
      }
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

function entryInPeriod(e, fromMs, toMs) {
  const ts = new Date(e.createdAt).getTime();
  return ts >= fromMs && ts <= toMs;
}

function aggregateClass(ctx, accountType, fromMs, toMs, officeFilter, signFn) {
  const { accounts, entries, toBase } = ctx;
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const byAccount = new Map();
  let total = 0;
  for (const e of entries) {
    if (!entryInPeriod(e, fromMs, toMs)) continue;
    const acc = accById.get(e.accountId);
    if (!acc || acc.type !== accountType) continue;
    if (!passesOfficeFilter(acc, officeFilter)) continue;
    const signed = signFn(e); // signed amount in native currency
    const inBase = toBase(signed, e.currency) || 0;
    const row = byAccount.get(acc.id) || { code: acc.code, name: acc.name, currency: acc.currency, amountInBase: 0, entryCount: 0 };
    row.amountInBase += inBase;
    row.entryCount += 1;
    byAccount.set(acc.id, row);
    total += inBase;
  }
  return { total, accounts: [...byAccount.values()].sort((a, b) => Math.abs(b.amountInBase) - Math.abs(a.amountInBase)) };
}

export function pnlForPeriod(ctx, period, officeFilter) {
  const fromMs = new Date(period.from).getTime();
  const toMs = new Date(period.to).getTime();
  // revenue: normally credited → +Cr −Dr
  const revenue = aggregateClass(ctx, "revenue", fromMs, toMs, officeFilter, (e) => (e.direction === "cr" ? e.amount : -e.amount));
  // expense: normally debited → +Dr −Cr
  const expense = aggregateClass(ctx, "expense", fromMs, toMs, officeFilter, (e) => (e.direction === "dr" ? e.amount : -e.amount));
  // fx: equity-class accounts with subtype fx_gain / fx_loss. gain: +Cr−Dr; loss: −(Dr−Cr) ⇒ +Cr−Dr too, but we present net = Σfx_gain − Σfx_loss.
  // Simpler: aggregate both as (+Cr−Dr) which makes gain positive and loss negative naturally.
  const { accounts, entries, toBase } = ctx;
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const fxAccounts = new Map();
  let fxNet = 0;
  for (const e of entries) {
    if (!entryInPeriod(e, fromMs, toMs)) continue;
    const acc = accById.get(e.accountId);
    if (!acc || acc.type !== "equity") continue;
    if (acc.subtype !== "fx_gain" && acc.subtype !== "fx_loss") continue;
    if (!passesOfficeFilter(acc, officeFilter)) continue;
    const signed = e.direction === "cr" ? e.amount : -e.amount; // gain↑ when credited
    const inBase = toBase(signed, e.currency) || 0;
    const row = fxAccounts.get(acc.id) || { code: acc.code, name: acc.name, currency: acc.currency, amountInBase: 0, entryCount: 0 };
    row.amountInBase += inBase;
    row.entryCount += 1;
    fxAccounts.set(acc.id, row);
    fxNet += inBase;
  }
  const netProfit = revenue.total - expense.total + fxNet;
  return {
    revenue,
    expense,
    fxNet,
    fxAccounts: [...fxAccounts.values()].sort((a, b) => Math.abs(b.amountInBase) - Math.abs(a.amountInBase)),
    netProfit,
  };
}

export function balanceCheckTotals(ctx, officeFilter) {
  const { accounts, balances, toBase } = ctx;
  const accById = new Map(accounts.map((a) => [a.id, a]));
  let assets = 0, liabilities = 0, equity = 0;
  for (const b of balances) {
    const acc = accById.get(b.accountId);
    if (!acc) continue;
    if (!passesOfficeFilter(acc, officeFilter)) continue;
    const inBase = toBase(b.balance, b.currency) || 0;
    if (acc.type === "asset") assets += inBase;
    else if (acc.type === "liability") liabilities += inBase;
    else if (acc.type === "equity") equity += inBase;
    // revenue/expense don't carry a balance-sheet balance (they roll into retained earnings) — ignore here
  }
  const delta = assets - (liabilities + equity);
  return { assets, liabilities, equity, identityCheck: { ok: Math.abs(delta) < 0.01, delta } };
}
