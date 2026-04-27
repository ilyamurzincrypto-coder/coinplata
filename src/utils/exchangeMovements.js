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

// opts.obligationLegs — Set<index> легов, для которых OUT movement НЕ создаётся
// (деньги обещаны но не выданы — висит as obligation в store/obligations).
// Защита от мусорных значений (NaN/Infinity/строки/отрицательные).
// `Math.abs(undefined||0)` уже даёт 0, но `Math.abs("foo")` = NaN, а
// `tx.amtIn || 0` не ловит NaN (NaN truthy). Возвращаем 0 как ясный
// сигнал — buildMovementsFromTransaction всё равно вернёт warning через
// hasAccount/empty outputs.
function safeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

export function buildMovementsFromTransaction(tx, accounts, createdBy, opts = {}) {
  const obligationLegs = opts.obligationLegs || new Set();
  const movements = [];
  const warnings = [];
  const isReserved = tx.status === "pending" || tx.status === "checking";

  const hasAccount = (id) =>
    !!id && accounts.some((a) => a.id === id && a.active !== false);

  // ---------- IN ----------
  if (tx.accountId && hasAccount(tx.accountId)) {
    const amount = safeAmount(tx.amtIn);
    if (amount === 0) {
      warnings.push(`IN: invalid amount (${tx.amtIn} ${tx.curIn})`);
    } else {
      movements.push({
        accountId: tx.accountId,
        amount,
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
    }
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
    if (obligationLegs.has(index)) {
      warnings.push(
        `OUT #${index + 1}: insufficient balance → obligation created (${out.amount} ${out.currency})`
      );
      return; // movement не создаём — висит obligation, деньги не списываются
    }
    if (!out.accountId || !hasAccount(out.accountId)) {
      warnings.push(`OUT #${index + 1}: account not selected (${out.amount} ${out.currency})`);
      return;
    }
    const outAmount = safeAmount(out.amount);
    if (outAmount === 0) {
      warnings.push(`OUT #${index + 1}: invalid amount (${out.amount} ${out.currency})`);
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
      amount: outAmount,
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
