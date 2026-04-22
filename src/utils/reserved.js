// src/utils/reserved.js
// Pure helpers для расчёта "зарезервированных" сумм из pending-транзакций.
// Не пишет никуда, только читает transactions[].
//
// ВАЖНО: это чисто визуальный слой. Pending сделки не создают movements,
// balanceOf() их не видит. Reserved — это "сколько мы должны выдать по
// отложенным сделкам" в разрезе (office, currency, accountId).

// Возвращает Map ключ → number:
//   key = `${officeId}|${currency}|${accountId}`
//   value = сумма output.amount всех pending tx для этого ключа
export function computeReservedByAccount(transactions) {
  const map = new Map();
  transactions.forEach((tx) => {
    if (tx.status !== "pending") return;
    const outs = Array.isArray(tx.outputs) && tx.outputs.length
      ? tx.outputs
      : tx.curOut && tx.amtOut
      ? [{ currency: tx.curOut, amount: tx.amtOut, accountId: tx.outAccountId }]
      : [];
    outs.forEach((o) => {
      if (!o.accountId) return;
      const key = `${tx.officeId}|${o.currency}|${o.accountId}`;
      map.set(key, (map.get(key) || 0) + (o.amount || 0));
    });
  });
  return map;
}

// reservedFor(id) — получить зарезервированное по конкретному accountId
// Удобная обёртка для UI: accepts the Map and the account.
export function reservedForAccount(reservedMap, account) {
  if (!account) return 0;
  const key = `${account.officeId}|${account.currency}|${account.id}`;
  return reservedMap.get(key) || 0;
}

// Агрегация в разрезе (officeId, currency) — для Balances на dashboard:
// сумма reserved по всем аккаунтам этого сочетания.
// Возвращает Map `${officeId}|${currency}` → amount.
export function computeReservedByOfficeCurrency(transactions) {
  const map = new Map();
  transactions.forEach((tx) => {
    if (tx.status !== "pending") return;
    const outs = Array.isArray(tx.outputs) && tx.outputs.length
      ? tx.outputs
      : tx.curOut && tx.amtOut
      ? [{ currency: tx.curOut, amount: tx.amtOut }]
      : [];
    outs.forEach((o) => {
      const key = `${tx.officeId}|${o.currency}`;
      map.set(key, (map.get(key) || 0) + (o.amount || 0));
    });
  });
  return map;
}
