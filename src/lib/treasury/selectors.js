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

const KNOWN_TYPES = new Set(["cash", "bank", "crypto"]);

export function groupByAccountType(ctx) {
  const { officeId, accounts, balanceOf, reservedOf, toBase } = ctx;
  const officeAccounts = accounts.filter((a) => a.officeId === officeId);
  const byType = new Map();
  for (const a of officeAccounts) {
    const type = KNOWN_TYPES.has(a.type) ? a.type : "other";
    const ccy = String(a.currency || a.currency_code || "").toUpperCase();
    const total = balanceOf(a.id) || 0;
    const reserved = reservedOf(a.id) || 0;
    const available = total - reserved;
    const totalInBase = ccy ? (toBase(total, ccy) || 0) : 0;
    const row = byType.get(type) || { type, count: 0, available: 0, reserved: 0, total: 0, totalInBase: 0 };
    row.count += 1;
    row.available += available;
    row.reserved += reserved;
    row.total += total;
    row.totalInBase += totalInBase;
    byType.set(type, row);
  }
  return [...byType.values()].sort((x, y) => y.totalInBase - x.totalInBase);
}

export function lastNMovements(ctx, n) {
  const { officeId, accounts, movements } = ctx;
  const officeAccountIds = new Set(
    accounts.filter((a) => a.officeId === officeId).map((a) => a.id)
  );
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  return movements
    .filter((m) => officeAccountIds.has(m.accountId))
    .sort((x, y) => new Date(y.timestamp) - new Date(x.timestamp))
    .slice(0, n)
    .map((m) => ({ ...m, accountName: accountById.get(m.accountId)?.name || "—" }));
}

function txTimestamp(tx) {
  // Real supabase rows have ISO `createdAt`. Seed-mode rows have `time` + `date`
  // strings. Fall back to "now" if absent (so the row isn't dropped from "today").
  if (tx.createdAt) return new Date(tx.createdAt);
  if (tx.timestamp) return new Date(tx.timestamp);
  return new Date(); // fallback — caller treats as "now"
}

function sumBalancesInBase(ctx, accountFilter) {
  const { accounts, balanceOf, toBase, officeId } = ctx;
  let total = 0;
  for (const a of accounts) {
    if (a.officeId !== officeId) continue;
    if (accountFilter && !accountFilter(a)) continue;
    const ccy = String(a.currency || a.currency_code || "").toUpperCase();
    if (!ccy) continue;
    total += toBase(balanceOf(a.id) || 0, ccy) || 0;
  }
  return total;
}

function sumAvailableInBase(ctx) {
  const { accounts, balanceOf, reservedOf, toBase, officeId } = ctx;
  let total = 0;
  for (const a of accounts) {
    if (a.officeId !== officeId) continue;
    const ccy = String(a.currency || a.currency_code || "").toUpperCase();
    if (!ccy) continue;
    const avail = (balanceOf(a.id) || 0) - (reservedOf(a.id) || 0);
    total += toBase(avail, ccy) || 0;
  }
  return total;
}

function sumLiabilitiesInBase(ctx) {
  const { obligations, officeId, toBase } = ctx;
  let total = 0;
  for (const o of obligations) {
    if (o.officeId !== officeId) continue;
    if (o.status !== "open") continue;
    if (o.direction !== "we_owe") continue;
    const ccy = String(o.currency || "").toUpperCase();
    total += toBase(o.amount || 0, ccy) || 0;
  }
  return total;
}

function activityCount(ctx, sinceMs, untilMs) {
  const { transactions, officeId } = ctx;
  let count = 0;
  for (const t of transactions) {
    if (t.officeId !== officeId) continue;
    const ts = txTimestamp(t).getTime();
    if (ts >= sinceMs && ts < untilMs) count += 1;
  }
  return count;
}

export function computeKPIs(ctx) {
  const nowDate = (ctx.now ? ctx.now() : new Date());
  const nowMs = nowDate.getTime();
  const since24hMs = nowMs - 24 * 3600 * 1000;
  const totalBalance = sumBalancesInBase(ctx);
  const liabilities = sumLiabilitiesInBase(ctx);
  const availableFunds = sumAvailableInBase(ctx);
  const activity = activityCount(ctx, since24hMs, nowMs + 1);
  return {
    totalBalance:   { valueInBase: totalBalance,   delta: null },
    liabilities:    { valueInBase: liabilities,    delta: null },
    availableFunds: { valueInBase: availableFunds, delta: null },
    activity24h:    { count: activity,             delta: null },
    baseCurrency: ctx.baseCurrency,
  };
}
