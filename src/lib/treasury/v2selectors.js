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

// Display-sign convention (DISPLAY ONLY — does not touch ledger data / RPCs / the
// selectors' computed values). Assets/expenses keep their stored normal-side magnitude;
// liabilities (Cr-normal "we owe") are negated at display time so an obligation reads as
// a negative number ("we owe $940" → −$940). Equity stays positive (Кт − Дт magnitude).
// So the identity reads literally: Капитал = Активы + Пассивы (Пассивы being negative).
export function displaySign(accountType) {
  return accountType === "liability" ? -1 : 1;
}

export const SUBTYPE_LABEL_KEYS = {
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
  nostro: "trv2_subtype_nostro",
  loro: "trv2_subtype_loro",
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

// Pivot-вид asset-счетов для вкладки Treasury → Активы: офисы в строках,
// валюты в колонках. Возвращает плоскую структуру для табличного UI.
// Колонки-валюты строятся из набора валют, встретившихся в asset-счетах
// (даже с нулевым балансом — если счёт в плане есть, колонка должна быть).
// Порядок колонок: ctx.baseCurrency первой, остальные по Σ|toBase(amount)| desc.
// Строки: null-office всегда последним, остальные по |totalInBase| desc.
//
// Returns: {
//   currencies: ["USD", "EUR", ...],
//   rows: [{
//     officeId: string|null,
//     totals: { [currency]: nativeAmount },
//     totalInBase,
//     accounts: [{ accountId, code, name, currency, balance, balanceInBase }]
//   }],
//   grandTotals: { [currency]: nativeAmount, inBase: number }
// }
export function assetsPivotByOffice(ctx) {
  const { accounts, balances, toBase, baseCurrency, officeFilter } = ctx;
  const balByAccount = new Map();
  for (const b of balances) {
    const arr = balByAccount.get(b.accountId) || [];
    arr.push(b);
    balByAccount.set(b.accountId, arr);
  }
  const byOffice = new Map();          // officeKey → row builder
  const ccyVolume = new Map();         // currency → Σ|inBase| across all visible rows
  const allCurrencies = new Set();     // все валюты asset-счетов (для колонок, даже с 0)
  for (const acc of accounts) {
    if (acc.type !== "asset") continue;
    if (!passesOfficeFilter(acc, officeFilter)) continue;
    const ccy = acc.currency || "?";
    allCurrencies.add(ccy);
    const rows = balByAccount.get(acc.id) || [];
    let balance = 0, balanceInBase = 0;
    for (const b of rows) {
      balance += Number(b.balance) || 0;
      balanceInBase += toBase(b.balance, b.currency) || 0;
    }
    const officeKey = acc.officeId || "__none__";
    const row = byOffice.get(officeKey) || {
      officeId: acc.officeId || null,
      totals: {},
      totalInBase: 0,
      accounts: [],
    };
    row.totals[ccy] = (row.totals[ccy] || 0) + balance;
    row.totalInBase += balanceInBase;
    row.accounts.push({
      accountId: acc.id, code: acc.code, name: acc.name,
      currency: acc.currency, balance, balanceInBase,
    });
    byOffice.set(officeKey, row);
    ccyVolume.set(ccy, (ccyVolume.get(ccy) || 0) + Math.abs(balanceInBase));
  }

  // Колонки: base первой, остальные по Σ|inBase| desc
  const currencies = [...allCurrencies].sort((a, b) => {
    if (a === baseCurrency && b !== baseCurrency) return -1;
    if (b === baseCurrency && a !== baseCurrency) return 1;
    return (ccyVolume.get(b) || 0) - (ccyVolume.get(a) || 0);
  });

  // Строки: листы по |balanceInBase| desc; null-office последним, остальные по |totalInBase| desc
  const rows = [...byOffice.values()]
    .map((r) => ({
      ...r,
      accounts: r.accounts.slice().sort((x, y) => Math.abs(y.balanceInBase) - Math.abs(x.balanceInBase)),
    }))
    .sort((a, b) => {
      if (a.officeId === null && b.officeId !== null) return 1;
      if (b.officeId === null && a.officeId !== null) return -1;
      return Math.abs(b.totalInBase) - Math.abs(a.totalInBase);
    });

  // grandTotals
  const grandTotals = { inBase: 0 };
  for (const ccy of currencies) grandTotals[ccy] = 0;
  for (const r of rows) {
    grandTotals.inBase += r.totalInBase;
    for (const ccy of currencies) {
      if (r.totals[ccy] != null) grandTotals[ccy] += r.totals[ccy];
    }
  }

  return { currencies, rows, grandTotals };
}

/**
 * Иерархический вид пассивов с группировкой по контрагенту вместо office.
 * Иерархия:
 *   Counterparty (client/partner) → Currency → Source ledger.account leaf
 *
 * Используется в Treasury → Пассивы (counterparty-режим, default) и
 * в DealForm для отображения балансов клиента.
 *
 * @param {object} ctx - { accounts, balances, toBase, clientById, partnerById, officeFilter }
 * @param {"client" | "partner"} cpKind - какой пул показывать
 * @returns Array<{
 *   id, kind, name, full_name, telegram, tag, isReferral, referrer_id,
 *   totalInBase,
 *   byCurrency: Array<{ currency, balance, balanceInBase,
 *     sourceAccounts: Array<{ accountId, code, name, subtype, balance }> }>
 * }>
 */
export function liabilitiesByCounterparty(ctx, cpKind = "client") {
  const { accounts, balances, toBase, clientById, partnerById, officeFilter } = ctx;
  const accById = new Map(accounts.map((a) => [a.id, a]));

  // Какие subtypes допустимы:
  //   client → customer_liab, unearned (последний без dim в БД, но
  //     если когда-то будет — сюда же)
  //   partner → partner_liab
  const allowedSubtypes = cpKind === "client"
    ? new Set(["customer_liab", "unearned"])
    : new Set(["partner_liab"]);

  const cpMap = new Map();

  for (const b of balances) {
    const balanceNum = Number(b.balance) || 0;
    if (Math.abs(balanceNum) < 1e-9) continue;

    const acc = accById.get(b.accountId);
    if (!acc || acc.type !== "liability") continue;
    if (!allowedSubtypes.has(acc.subtype)) continue;
    if (!passesOfficeFilter(acc, officeFilter)) continue;

    const cpId = cpKind === "client" ? b.clientId : b.partnerId;
    if (!cpId) continue;

    const cpData = cpKind === "client"
      ? clientById?.get?.(cpId)
      : partnerById?.get?.(cpId);
    if (!cpData) continue; // архивирован или загрузка ещё не пришла

    let cp = cpMap.get(cpId);
    if (!cp) {
      cp = {
        id: cpId,
        kind: cpKind,
        name: cpData.nickname || cpData.name || String(cpId).slice(0, 8),
        full_name: cpData.full_name || null,
        telegram: cpData.telegram || null,
        tag: cpData.tag || null,
        // 0108: канон — boolean clients.is_referral; legacy tag-эвристика
        // оставлена fallback'ом для in-memory объектов без is_referral.
        isReferral: !!(
          cpData.isReferral === true ||
          (cpData.tag && /referral|реферал/i.test(cpData.tag))
        ),
        referrer_id: cpData.referrer_id || null,
        totalInBase: 0,
        byCurrency: new Map(),
      };
      cpMap.set(cpId, cp);
    }

    const ccyKey = b.currencyCode || b.currency || "?";
    let cur = cp.byCurrency.get(ccyKey);
    if (!cur) {
      cur = { currency: ccyKey, balance: 0, balanceInBase: 0, sourceAccounts: [] };
      cp.byCurrency.set(ccyKey, cur);
    }
    cur.balance += balanceNum;
    const inBase = toBase ? (toBase(balanceNum, ccyKey) || 0) : 0;
    cur.balanceInBase += inBase;
    cur.sourceAccounts.push({
      accountId: b.accountId,
      code: acc.code,
      name: acc.name,
      subtype: acc.subtype,
      balance: balanceNum,
    });
    cp.totalInBase += inBase;
  }

  return [...cpMap.values()]
    .map((cp) => ({
      ...cp,
      byCurrency: [...cp.byCurrency.values()]
        .sort((a, b) => Math.abs(b.balanceInBase) - Math.abs(a.balanceInBase))
        .map((c) => ({
          ...c,
          sourceAccounts: c.sourceAccounts.slice().sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
        })),
    }))
    .sort((a, b) => {
      // Реферальные сверху, потом по |totalInBase| desc
      if (a.isReferral && !b.isReferral) return -1;
      if (!a.isReferral && b.isReferral) return 1;
      return Math.abs(b.totalInBase) - Math.abs(a.totalInBase);
    });
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
  const { type = "all", officeFilter = "all", period, counterpartyId = null } = opts;
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
      if (counterpartyId) {
        // keep if any entry carries this client_id OR partner_id (the same id space
        // is shared — picker resolves a counterparty to one of the two subconto dims).
        const txEntries = entriesByTx.get(t.id) || [];
        const touches = txEntries.some((e) => e.clientId === counterpartyId || e.partnerId === counterpartyId);
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

// The all-zero UUID is used as the "no counterparty" sentinel on entries — treat it
// (and falsy values) as "no id" so we don't run counterpartyName() against it.
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
function nonZeroId(id) {
  return id && id !== ZERO_UUID ? id : null;
}

// Free-text matcher for the Treasury list views (Журнал / Сделки). `q` is the
// ALREADY-lowercased query; returns true when the empty query is passed (so callers
// can skip filtering). A node matches if `q` is a substring of any of: the tx's
// description / metadata.comment / metadata.client_nickname / kind / sourceRefId /
// id; any entry's accountCode / accountName / currency / amount / note; the
// counterparty name resolved from each entry's clientId/partnerId; and the optional
// pre-formatted deal-summary line (`summaryText`).
export function nodeMatchesSearch(node, q, ctx, accById, summaryText = "") {
  if (!q) return true;
  const tx = node?.tx || {};
  const hay = [];
  hay.push(tx.description, tx.metadata?.comment, tx.metadata?.client_nickname, tx.kind, tx.sourceRefId, tx.id);
  const cpName = (id) => {
    const real = nonZeroId(id);
    if (!real || !ctx?.counterpartyName) return null;
    try { return ctx.counterpartyName(real); } catch { return null; }
  };
  for (const e of node?.entries || []) {
    hay.push(
      e.accountCode || (accById && accById.get(e.accountId)?.code),
      e.accountName || (accById && accById.get(e.accountId)?.name),
      e.currency,
      e.amount != null ? String(e.amount) : null,
      e.note,
      cpName(e.clientId),
      cpName(e.partnerId),
    );
  }
  if (summaryText) hay.push(summaryText);
  return hay.some((v) => v != null && String(v).toLowerCase().includes(q));
}

// An entry's "when" for period reports is its transaction's effective_date — the
// accounting date the user chose — NOT createdAt (insertion time). Back-dated manual
// entries must land in the period they're dated, consistent with trialBalance /
// chessTurnover / transactionTree. Fall back to createdAt only if the tx is unknown.
function entryEffMs(e, txEffMs) {
  const t = txEffMs.get(e.transactionId);
  return t != null ? t : new Date(e.createdAt).getTime();
}

function aggregateClass(ctx, accountType, fromMs, toMs, officeFilter, signFn, txEffMs) {
  const { accounts, entries, toBase } = ctx;
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const byAccount = new Map();
  let total = 0;
  for (const e of entries) {
    const ts = entryEffMs(e, txEffMs);
    if (ts < fromMs || ts > toMs) continue;
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
  const txEffMs = new Map((ctx.transactions || []).map((t) => [t.id, new Date(t.effectiveDate).getTime()]));
  // revenue: normally credited → +Cr −Dr
  const revenue = aggregateClass(ctx, "revenue", fromMs, toMs, officeFilter, (e) => (e.direction === "cr" ? e.amount : -e.amount), txEffMs);
  // expense: normally debited → +Dr −Cr
  const expense = aggregateClass(ctx, "expense", fromMs, toMs, officeFilter, (e) => (e.direction === "dr" ? e.amount : -e.amount), txEffMs);
  // fx: equity-class accounts with subtype fx_gain / fx_loss. gain: +Cr−Dr; loss: −(Dr−Cr) ⇒ +Cr−Dr too, but we present net = Σfx_gain − Σfx_loss.
  // Simpler: aggregate both as (+Cr−Dr) which makes gain positive and loss negative naturally.
  const { accounts, entries, toBase } = ctx;
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const fxAccounts = new Map();
  let fxNet = 0;
  for (const e of entries) {
    const ts = entryEffMs(e, txEffMs);
    if (ts < fromMs || ts > toMs) continue;
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
    // Account-level metrics always come from the whole-account aggregate so they're
    // complete regardless of which entries carry a subconto. For a strictly-dimensioned
    // account every entry carries one, so Σ dims == this; for an account that's only
    // partially dimensioned the `dims` rows are a partial breakdown (the difference is
    // the un-subconto'd remainder) — which is honest, and far better than the previous
    // Σ-dims-only total that silently dropped that remainder.
    const cur = curBal.get(accId) || 0;
    const rec = agg.get(accId) || { sinceFrom: 0, afterTo: 0, drTurn: 0, crTurn: 0 };
    const acctOpening = cur - rec.sinceFrom;
    const acctClosing = cur - rec.afterTo;
    const acctDr = rec.drTurn;
    const acctCr = rec.crTurn;
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
//
// `currency` (optional): when a currency code is passed, the matrix is built in that
// NATIVE currency — only entries in that currency are considered, amounts are not
// converted to base, and the per-tx allocation runs over the same-currency Dr/Cr legs.
// Row sums still equal each account's Dr turnover in that currency; for cross-currency
// transactions the column sums may exceed Cr turnover (the "missing" leg is in another
// currency) — that's the standard limitation of a single-currency turnover sheet.
// When `currency` is falsy → the original base-currency behaviour.
export function chessTurnover(ctx, period, officeFilter, currency = null) {
  const { transactions, entries, accounts, toBase } = ctx;
  const fromMs = new Date(period.from).getTime();
  const toMs = new Date(period.to).getTime();
  const native = !!currency;
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const entriesByTx = new Map();
  for (const e of entries) {
    if (native && e.currency !== currency) continue;
    const arr = entriesByTx.get(e.transactionId) || [];
    arr.push(e);
    entriesByTx.set(e.transactionId, arr);
  }
  const amountOf = (e) => (native ? Number(e.amount) || 0 : toBase(Number(e.amount), e.currency) || 0);
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
    if (txEntries.length === 0) continue;
    if (officeFilter !== "all" && officeFilter) {
      const touches = txEntries.some((e) => accById.get(e.accountId)?.officeId === officeFilter);
      if (!touches) continue;
    }
    const drLegs = [], crLegs = [];
    for (const e of txEntries) {
      const amt = amountOf(e);
      if (e.direction === "dr") drLegs.push({ accId: e.accountId, amt });
      else crLegs.push({ accId: e.accountId, amt });
    }
    const totalCr = crLegs.reduce((s, c) => s + c.amt, 0);
    if (totalCr === 0) continue;
    for (const d of drLegs) for (const c of crLegs) add(d.accId, c.accId, (d.amt * c.amt) / totalCr);
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
  return { currency: currency || ctx.baseCurrency, isNative: native, accounts: accList, rows, rowTotals, colTotals, grandTotal };
}

export function balanceCheckTotals(ctx, officeFilter) {
  const { accounts, balances, toBase } = ctx;
  const accById = new Map(accounts.map((a) => [a.id, a]));
  let assets = 0, liabilities = 0, equityAccounts = 0, revenue = 0, expense = 0;
  for (const b of balances) {
    const acc = accById.get(b.accountId);
    if (!acc) continue;
    if (!passesOfficeFilter(acc, officeFilter)) continue;
    const inBase = toBase(b.balance, b.currency) || 0;
    if (acc.type === "asset") assets += inBase;
    else if (acc.type === "liability") liabilities += inBase;
    else if (acc.type === "equity") equityAccounts += inBase;
    else if (acc.type === "revenue") revenue += inBase;
    else if (acc.type === "expense") expense += inBase;
  }
  // Net profit-to-date that hasn't been closed into retained earnings yet — there is no
  // period-close routine, so revenue/expense balances accumulate forever. They're real
  // equity-in-progress, so the accounting identity is
  //   Assets = Liabilities + (Equity accounts) + (Revenue − Expense).
  const pnl = revenue - expense;
  const equity = equityAccounts + pnl;          // total equity incl. unrealised P&L
  const delta = assets - (liabilities + equity);
  return {
    assets, liabilities, equity, equityAccounts, pnl,
    identityCheck: { ok: Math.abs(delta) < 0.5, delta },
  };
}
