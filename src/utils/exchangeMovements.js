// src/utils/exchangeMovements.js
// Pure helper — из tx строит список движений денег.
// Не пишет в store, только формирует data.
//
// ПРАВИЛО accounts:
//   Если tx.accountId не указан → IN movement НЕ пишется, возвращается warning.
//   Если output.accountId не указан → OUT movement НЕ пишется, warning.
//
// RESERVED FLAG:
//   Если tx.status === "pending" — все созданные movements получают reserved: true.
//   Когда pending → completed, вызывающий код делает unreserveMovementsByRefId().

export function buildMovementsFromTransaction(tx, accounts, createdBy) {
  const movements = [];
  const warnings = [];
  const isReserved = tx.status === "pending";

  const hasAccount = (id) =>
    !!id && accounts.some((a) => a.id === id && a.active !== false);

  // ---------- IN ----------
  if (tx.accountId && hasAccount(tx.accountId)) {
    movements.push({
      accountId: tx.accountId,
      amount: Math.abs(tx.amtIn || 0),
      direction: "in",
      currency: tx.curIn,
      reserved: isReserved,
      source: {
        kind: "exchange_in",
        refId: String(tx.id),
        note: `Deal #${tx.id}`,
      },
      createdBy,
    });
  } else {
    warnings.push(`IN: account not selected (${tx.amtIn} ${tx.curIn})`);
  }

  // ---------- OUT ----------
  const outs = Array.isArray(tx.outputs) && tx.outputs.length > 0
    ? tx.outputs
    : tx.curOut && tx.amtOut
    ? [{ currency: tx.curOut, amount: tx.amtOut, accountId: tx.outAccountId }]
    : [];

  outs.forEach((out, index) => {
    if (!out.accountId || !hasAccount(out.accountId)) {
      warnings.push(`OUT #${index + 1}: account not selected (${out.amount} ${out.currency})`);
      return;
    }
    movements.push({
      accountId: out.accountId,
      amount: Math.abs(out.amount || 0),
      direction: "out",
      currency: out.currency,
      reserved: isReserved,
      source: {
        kind: "exchange_out",
        refId: String(tx.id),
        note: `Deal #${tx.id} · output ${index + 1}`,
      },
      createdBy,
    });
  });

  return { movements, warnings };
}
