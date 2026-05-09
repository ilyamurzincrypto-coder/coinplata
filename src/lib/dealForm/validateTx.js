// src/lib/dealForm/validateTx.js
// Pure validation for the unified legs[] payload before buildTx maps it
// to v2 RPC shape. Returns { ok, errors } so the UI can disable Submit
// and highlight individual fields rather than discovering errors via
// throw on submit.

export function validateTx(payload) {
  const errors = [];
  if (!payload || !payload.officeId) {
    errors.push({ field: "officeId", code: "office_required", message: "Выбери офис" });
  }
  const legs = (payload && payload.legs) || [];
  for (const leg of legs) {
    const amt = Number(leg.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      errors.push({ legId: leg.id, side: leg.side, field: "amount", code: "amount_must_be_positive", message: "Сумма > 0" });
    }
    if (!leg.currency || String(leg.currency).length < 2) {
      errors.push({ legId: leg.id, side: leg.side, field: "currency", code: "currency_required", message: "Укажи валюту" });
    }
    if (leg.side === "in") {
      const source = leg.source === "from_balance" ? "from_balance" : "fresh";
      if (source === "fresh" && !leg.accountId) {
        errors.push({ legId: leg.id, side: "in", field: "accountId", code: "fresh_requires_accountId", message: "Выбери счёт зачисления" });
      }
    } else if (leg.side === "out") {
      const destination = leg.destination === "to_balance" ? "to_balance" : "physical";
      if (destination === "to_balance" && leg.deferred) {
        errors.push({ legId: leg.id, side: "out", field: "deferred", code: "to_balance_cannot_be_deferred", message: "to_balance не может быть deferred" });
      }
      if (destination === "physical" && !leg.accountId) {
        errors.push({ legId: leg.id, side: "out", field: "accountId", code: "physical_requires_accountId", message: "Выбери счёт списания" });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
