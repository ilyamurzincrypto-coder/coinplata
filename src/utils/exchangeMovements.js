// src/utils/exchangeMovements.js
// Pure helper — из tx строит список движений денег.
// Не пишет в store, только формирует data.
//
// ПРАВИЛО accounts:
//   Если tx.accountId не указан → IN movement НЕ пишется, возвращается warning.
//   Если output.accountId не указан → OUT movement НЕ пишется, warning.
//
// RESERVED FLAG:
//   Если tx.status === "pending" — manually pending (менеджер сам завершит)
//   Если tx.status === "checking" — crypto deal, ждущая blockchain-подтверждения
//   В обоих случаях movements получают reserved: true. Когда статус переходит
//   в "completed" — вызывающий код делает unreserveMovementsByRefId().

export function buildMovementsFromTransaction(tx, accounts, createdBy) {
  const movements = [];
  const warnings = [];
  const isReserved = tx.status === "pending" || tx.status === "checking";

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
    // Crypto OUT с sendStatus не "confirmed" → движение резервируется отдельно
    // (независимо от tx.status). Так балансы не списываются пока менеджер
    // не подтвердит on-chain отправку.
    const hasSendFlow =
      typeof out.sendStatus === "string" && out.sendStatus.length > 0;
    const outReserved =
      isReserved || (hasSendFlow && out.sendStatus !== "confirmed");
    movements.push({
      accountId: out.accountId,
      amount: Math.abs(out.amount || 0),
      direction: "out",
      currency: out.currency,
      reserved: outReserved,
      source: {
        kind: "exchange_out",
        refId: String(tx.id),
        outputIndex: index,
        note: `Deal #${tx.id} · output ${index + 1}`,
      },
      createdBy,
    });
  });

  return { movements, warnings };
}
