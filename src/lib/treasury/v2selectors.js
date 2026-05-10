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
  const bySubtype = new Map();
  for (const acc of accounts) {
    if (acc.type !== accountType) continue;
    if (!passesOfficeFilter(acc, officeFilter)) continue;
    const rowsForAccount = balances.filter((b) => b.accountId === acc.id);
    const isDimensioned = acc.clientDimRequired || acc.partnerDimRequired || rowsForAccount.some((b) => b.clientId || b.partnerId);
    let balance = 0, balanceInBase = 0;
    const dimList = [];
    for (const b of rowsForAccount) {
      const inBase = toBase(b.balance, b.currency) || 0;
      balance += Number(b.balance) || 0;
      balanceInBase += inBase;
      dimList.push({ clientId: b.clientId || null, partnerId: b.partnerId || null, balance: Number(b.balance) || 0, balanceInBase: inBase });
    }
    const dims = isDimensioned ? dimList.slice().sort((x, y) => Math.abs(y.balanceInBase) - Math.abs(x.balanceInBase)) : null;
    const subtype = acc.subtype || "other";
    const sect = bySubtype.get(subtype) || { subtype, labelKey: SUBTYPE_LABEL_KEYS[subtype] || "trv2_subtype_other", accounts: [], totalInBase: 0 };
    sect.accounts.push({ accountId: acc.id, code: acc.code, name: acc.name, currency: acc.currency, balance, balanceInBase, dims });
    sect.totalInBase += balanceInBase;
    bySubtype.set(subtype, sect);
  }
  return [...bySubtype.values()].sort((a, b) => b.totalInBase - a.totalInBase);
}

export function accountEntries(ctx, accountId, limit = 50, period = null, dim = null) {
  const { entries, transactions } = ctx;
  const txById = new Map(transactions.map((t) => [t.id, t]));
  const fromMs = period ? new Date(period.from).getTime() : -Infinity;
  const toMs = period ? new Date(period.to).getTime() : Infinity;
  return entries
    .filter((e) => e.accountId === accountId)
    .filter((e) => !dim || ((dim.clientId == null || e.clientId === dim.clientId) && (dim.partnerId == null || e.partnerId === dim.partnerId)))
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

const DR_NORMAL_TYPES = new Set(["asset", "expense"]);
function normalSign(account, entry) {
  const onNormalSide = DR_NORMAL_TYPES.has(account.type) ? entry.direction === "dr" : entry.direction === "cr";
  return (onNormalSide ? 1 : -1) * Number(entry.amount);
}

const TB_CLASS_ORDER = ["asset", "liability", "equity", "revenue", "expense"];
const TB_CLASS_LABEL_KEYS = {
  asset: "trv2_tab_assets", liability: "trv2_tab_liabilities", equity: "trv2_tab_equity",
  revenue: "trv2_to_class_revenue", expense: "trv2_to_class_expense",
};

// Оборотно-сальдовая ведомость over [period.from, period.to], attributing entries by
// their transaction's effectiveDate. opening/closing = current balance (magnitude on the
// account's normal side) minus the rollback of normalSign over entries since `from` (resp. after `to`).
export function trialBalance(ctx, period, officeFilter) {
  const { accounts, balances, entries, transactions, toBase } = ctx;
  const fromMs = new Date(period.from).getTime();
  const toMs = new Date(period.to).getTime();
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const txEffMs = new Map(transactions.map((t) => [t.id, new Date(t.effectiveDate).getTime()]));

  const curBal = new Map();
  for (const b of balances) curBal.set(b.accountId, (curBal.get(b.accountId) || 0) + Number(b.balance));

  const agg = new Map();        // accId -> { sinceFrom, afterTo, drTurn, crTurn }
  const aggDim = new Map();     // `${accId}|${dimKey}` -> { sinceFrom, afterTo, drTurn, crTurn }
  const dimMeta = new Map();    // `${accId}|${dimKey}` -> { clientId, partnerId }
  for (const e of entries) {
    const acc = accById.get(e.accountId);
    if (!acc || !passesOfficeFilter(acc, officeFilter)) continue;
    const ts = txEffMs.get(e.transactionId);
    if (ts == null) continue;
    const s = normalSign(acc, e);
    const rec = agg.get(e.accountId) || { sinceFrom: 0, afterTo: 0, drTurn: 0, crTurn: 0 };
    const dimKey = e.clientId || e.partnerId || "";
    const dk = `${e.accountId}|${dimKey}`;
    const drec = aggDim.get(dk) || { sinceFrom: 0, afterTo: 0, drTurn: 0, crTurn: 0 };
    if (!dimMeta.has(dk)) dimMeta.set(dk, { clientId: e.clientId || null, partnerId: e.partnerId || null });
    if (ts >= fromMs) { rec.sinceFrom += s; drec.sinceFrom += s; }
    if (ts > toMs) { rec.afterTo += s; drec.afterTo += s; }
    if (ts >= fromMs && ts <= toMs) {
      if (e.direction === "dr") { rec.drTurn += Number(e.amount); drec.drTurn += Number(e.amount); }
      else { rec.crTurn += Number(e.amount); drec.crTurn += Number(e.amount); }
    }
    agg.set(e.accountId, rec);
    aggDim.set(dk, drec);
  }
  const curBalDim = new Map(); // `${accId}|${dimKey}` -> balance
  for (const b of balances) {
    const dimKey = b.clientId || b.partnerId || "";
    const dk = `${b.accountId}|${dimKey}`;
    curBalDim.set(dk, (curBalDim.get(dk) || 0) + Number(b.balance));
    if (!dimMeta.has(dk)) dimMeta.set(dk, { clientId: b.clientId || null, partnerId: b.partnerId || null });
  }

  const byClass = new Map();
  const candidates = new Set([...curBal.keys(), ...agg.keys()]);
  for (const accId of candidates) {
    const acc = accById.get(accId);
    if (!acc || !passesOfficeFilter(acc, officeFilter)) continue;
    const ccy = acc.currency;
    const dimKeysForAcc = new Set();
    for (const k of curBalDim.keys()) if (k.startsWith(`${accId}|`)) dimKeysForAcc.add(k.slice(accId.length + 1));
    for (const k of aggDim.keys()) if (k.startsWith(`${accId}|`)) dimKeysForAcc.add(k.slice(accId.length + 1));
    dimKeysForAcc.delete(""); // the "no-dim" bucket isn't a subconto row
    const isDimensioned = acc.clientDimRequired || acc.partnerDimRequired || dimKeysForAcc.size > 0;
    let dims = null;
    if (isDimensioned) {
      dims = [...dimKeysForAcc].map((dimKey) => {
        const dk = `${accId}|${dimKey}`;
        const cb = curBalDim.get(dk) || 0;
        const dr = aggDim.get(dk) || { sinceFrom: 0, afterTo: 0, drTurn: 0, crTurn: 0 };
        const opening = cb - dr.sinceFrom, closing = cb - dr.afterTo;
        const meta = dimMeta.get(dk) || { clientId: null, partnerId: null };
        return {
          clientId: meta.clientId, partnerId: meta.partnerId,
          opening, debitTurnover: dr.drTurn, creditTurnover: dr.crTurn, closing,
          openingInBase: toBase(opening, ccy) || 0,
          debitTurnoverInBase: toBase(dr.drTurn, ccy) || 0,
          creditTurnoverInBase: toBase(dr.crTurn, ccy) || 0,
          closingInBase: toBase(closing, ccy) || 0,
        };
      }).sort((a, b) => Math.abs(b.closingInBase) - Math.abs(a.closingInBase));
    }
    let acctOpening, acctClosing, acctDr, acctCr;
    if (dims) {
      acctOpening = dims.reduce((s, d) => s + d.opening, 0);
      acctClosing = dims.reduce((s, d) => s + d.closing, 0);
      acctDr = dims.reduce((s, d) => s + d.debitTurnover, 0);
      acctCr = dims.reduce((s, d) => s + d.creditTurnover, 0);
    } else {
      const cur = curBal.get(accId) || 0;
      const rec = agg.get(accId) || { sinceFrom: 0, afterTo: 0, drTurn: 0, crTurn: 0 };
      acctOpening = cur - rec.sinceFrom; acctClosing = cur - rec.afterTo;
      acctDr = rec.drTurn; acctCr = rec.crTurn;
    }
    if (Math.abs(acctOpening) < 1e-9 && Math.abs(acctClosing) < 1e-9 && acctDr === 0 && acctCr === 0 && (!dims || dims.length === 0)) continue;
    const row = {
      accountId: accId, code: acc.code, name: acc.name, type: acc.type, subtype: acc.subtype || null, currency: ccy,
      opening: acctOpening, debitTurnover: acctDr, creditTurnover: acctCr, closing: acctClosing,
      openingInBase: toBase(acctOpening, ccy) || 0,
      debitTurnoverInBase: toBase(acctDr, ccy) || 0,
      creditTurnoverInBase: toBase(acctCr, ccy) || 0,
      closingInBase: toBase(acctClosing, ccy) || 0,
      dims,
    };
    const cls = byClass.get(acc.type) || {
      type: acc.type, labelKey: TB_CLASS_LABEL_KEYS[acc.type] || "trv2_to_class_other", accounts: [],
      subtotalInBase: { opening: 0, debitTurnover: 0, creditTurnover: 0, closing: 0 },
    };
    cls.accounts.push(row);
    cls.subtotalInBase.opening += row.openingInBase;
    cls.subtotalInBase.debitTurnover += row.debitTurnoverInBase;
    cls.subtotalInBase.creditTurnover += row.creditTurnoverInBase;
    cls.subtotalInBase.closing += row.closingInBase;
    byClass.set(acc.type, cls);
  }
  for (const cls of byClass.values()) cls.accounts.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const classes = TB_CLASS_ORDER.filter((t) => byClass.has(t)).map((t) => byClass.get(t));

  let openingDr = 0, openingCr = 0, debitTurnover = 0, creditTurnover = 0, closingDr = 0, closingCr = 0;
  for (const cls of classes) {
    const drSide = DR_NORMAL_TYPES.has(cls.type);
    if (drSide) { openingDr += cls.subtotalInBase.opening; closingDr += cls.subtotalInBase.closing; }
    else { openingCr += cls.subtotalInBase.opening; closingCr += cls.subtotalInBase.closing; }
    debitTurnover += cls.subtotalInBase.debitTurnover;
    creditTurnover += cls.subtotalInBase.creditTurnover;
  }
  return {
    classes,
    totalInBase: { openingDr, openingCr, debitTurnover, creditTurnover, closingDr, closingCr },
    check: {
      openingOk: Math.abs(openingDr - openingCr) < 0.01, openingDelta: openingDr - openingCr,
      turnoverOk: Math.abs(debitTurnover - creditTurnover) < 0.01, turnoverDelta: debitTurnover - creditTurnover,
      closingOk: Math.abs(closingDr - closingCr) < 0.01, closingDelta: closingDr - closingCr,
    },
  };
}

// Шахматка: account×account base-currency turnover matrix for [from,to] (transactions
// attributed by effectiveDate). For each tx, each Dr leg's base amount is allocated across
// the Cr legs in proportion to their base amounts. Row sums == Σ Dr turnover per account,
// column sums == Σ Cr turnover per account.
export function chessTurnover(ctx, period, officeFilter) {
  const { transactions, entries, accounts, toBase } = ctx;
  const fromMs = new Date(period.from).getTime();
  const toMs = new Date(period.to).getTime();
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const entriesByTx = new Map();
  for (const e of entries) {
    const arr = entriesByTx.get(e.transactionId) || [];
    arr.push(e);
    entriesByTx.set(e.transactionId, arr);
  }
  const rows = new Map();
  const add = (drId, crId, v) => {
    let m = rows.get(drId);
    if (!m) { m = new Map(); rows.set(drId, m); }
    m.set(crId, (m.get(crId) || 0) + v);
  };
  for (const t of transactions) {
    const ts = new Date(t.effectiveDate).getTime();
    if (ts < fromMs || ts > toMs) continue;
    const txEntries = entriesByTx.get(t.id) || [];
    if (officeFilter !== "all" && officeFilter) {
      const touches = txEntries.some((e) => accById.get(e.accountId)?.officeId === officeFilter);
      if (!touches) continue;
    }
    const drLegs = [], crLegs = [];
    for (const e of txEntries) {
      const base = toBase(Number(e.amount), e.currency) || 0;
      if (e.direction === "dr") drLegs.push({ accId: e.accountId, base });
      else crLegs.push({ accId: e.accountId, base });
    }
    const totalCr = crLegs.reduce((s, c) => s + c.base, 0);
    if (totalCr === 0) continue;
    for (const d of drLegs) for (const c of crLegs) add(d.accId, c.accId, (d.base * c.base) / totalCr);
  }
  const rowTotals = new Map(), colTotals = new Map();
  const appearing = new Set();
  for (const [drId, m] of rows) {
    let rt = 0;
    for (const [crId, v] of m) {
      if (Math.abs(v) < 1e-9) continue;
      rt += v;
      appearing.add(crId);
      colTotals.set(crId, (colTotals.get(crId) || 0) + v);
    }
    if (Math.abs(rt) > 1e-9) { appearing.add(drId); rowTotals.set(drId, rt); }
  }
  let grandTotal = 0;
  for (const v of rowTotals.values()) grandTotal += v;
  const accList = [...appearing].map((id) => {
    const a = accById.get(id) || {};
    return { accountId: id, code: a.code || "?", name: a.name || "?", type: a.type, subtype: a.subtype || null };
  }).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  return { accounts: accList, rows, rowTotals, colTotals, grandTotal };
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
