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
