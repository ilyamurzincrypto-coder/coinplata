// src/utils/exchangeMovements.js
// Pure helper — из tx строит список движений денег.
// Не пишет в store, только формирует data.
//
// ПРАВИЛО:
//   Если tx.accountId не указан → IN movement НЕ пишется, возвращается warning.
//   Если output.accountId не указан → OUT movement НЕ пишется, warning.
// Никаких auto-pick / first-match — менеджер сам отвечает за выбор счёта.
// Это upstream gate: балансы не должны меняться без осознанного решения.

// tx: {id, officeId, curIn, amtIn, outputs: [{currency, amount, accountId?}], accountId?, ...}
// accounts: весь массив (используется только для валидации что account существует)
// createdBy: user id
// Возвращает: { movements: [...], warnings: [...] }
export function buildMovementsFromTransaction(tx, accounts, createdBy) {
  const movements = [];
  const warnings = [];

  const hasAccount = (id) =>
    !!id && accounts.some((a) => a.id === id && a.active !== false);

  // ---------- IN ----------
  if (tx.accountId && hasAccount(tx.accountId)) {
    movements.push({
      accountId: tx.accountId,
      amount: Math.abs(tx.amtIn || 0),
      direction: "in",
      currency: tx.curIn,
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
