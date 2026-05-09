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

function balanceOfAtCutoff(ctx, accountId, cutoffMs) {
  const { movements } = ctx;
  return movements
    .filter((m) => m.accountId === accountId && !m.reserved && new Date(m.timestamp).getTime() < cutoffMs)
    .reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
}

function reservedOfAtCutoff(ctx, accountId, cutoffMs) {
  const { movements } = ctx;
  return movements
    .filter((m) => m.accountId === accountId && m.reserved && m.direction === "out" && new Date(m.timestamp).getTime() < cutoffMs)
    .reduce((s, m) => s + m.amount, 0);
}

function snapshotInBase(ctx, cutoffMs) {
  const { accounts, toBase, officeId } = ctx;
  let total = 0;
  let avail = 0;
  for (const a of accounts) {
    if (a.officeId !== officeId) continue;
    const ccy = String(a.currency || a.currency_code || "").toUpperCase();
    if (!ccy) continue;
    const bal = balanceOfAtCutoff(ctx, a.id, cutoffMs);
    const res = reservedOfAtCutoff(ctx, a.id, cutoffMs);
    total += toBase(bal, ccy) || 0;
    avail += toBase(bal - res, ccy) || 0;
  }
  return { totalInBase: total, availableInBase: avail };
}

function liabilitiesInBaseAtCutoff(ctx, cutoffMs) {
  const { obligations, officeId, toBase } = ctx;
  let total = 0;
  for (const o of obligations) {
    if (o.officeId !== officeId) continue;
    if (o.direction !== "we_owe") continue;
    if (!o.createdAt) continue;
    const created = new Date(o.createdAt).getTime();
    if (created >= cutoffMs) continue;
    if (o.status !== "open") {
      // If closed, it counts only if closure happened after cutoff.
      const closed = o.closedAt ? new Date(o.closedAt).getTime() : 0;
      if (closed && closed < cutoffMs) continue;
    }
    const ccy = String(o.currency || "").toUpperCase();
    total += toBase(o.amount || 0, ccy) || 0;
  }
  return total;
}

function pctDelta(today, yesterday) {
  if (yesterday === 0 || yesterday === null || yesterday === undefined) return null;
  return (today - yesterday) / yesterday;
}

export function computeKPIs(ctx) {
  const nowDate = (ctx.now ? ctx.now() : new Date());
  const nowMs = nowDate.getTime();
  const ms24h = 24 * 3600 * 1000;
  const since24hMs = nowMs - ms24h;
  const since48hMs = nowMs - 2 * ms24h;

  const today = snapshotInBase(ctx, nowMs + 1);
  const yesterday = snapshotInBase(ctx, since24hMs);
  const todayLiab = sumLiabilitiesInBase(ctx);
  const yestLiab = liabilitiesInBaseAtCutoff(ctx, since24hMs);
  const todayActivity = activityCount(ctx, since24hMs, nowMs + 1);
  const priorActivity = activityCount(ctx, since48hMs, since24hMs);

  return {
    totalBalance: {
      valueInBase: today.totalInBase,
      delta: pctDelta(today.totalInBase, yesterday.totalInBase),
    },
    liabilities: {
      valueInBase: todayLiab,
      delta: pctDelta(todayLiab, yestLiab),
    },
    availableFunds: {
      valueInBase: today.availableInBase,
      delta: pctDelta(today.availableInBase, yesterday.availableInBase),
    },
    activity24h: {
      count: todayActivity,
      delta: todayActivity - priorActivity, // absolute delta for activity
    },
    baseCurrency: ctx.baseCurrency,
  };
}
