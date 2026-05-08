// src/components/cashier/BalanceBadge.jsx
// Маленький бейдж под cell — показывает balance клиента/счёта и
// indicate overdraft (red text).

import React from "react";
import { fmt, curSymbol } from "../../utils/money.js";

export default function BalanceBadge({
  amount,           // number: баланс (после operation)
  currency,
  label = "",       // "клиент" | "касса" — для tooltip context
  overdraft = false,
  shortage,         // number: на сколько overdraft (для tooltip)
}) {
  if (amount == null || !currency) return null;
  const tone = overdraft ? "text-rose-600 font-semibold" : "text-slate-400";
  const title = overdraft && shortage != null
    ? `${label}: ${currency} overdraft ${fmt(shortage, currency)}`
    : `${label}: ${curSymbol(currency)}${fmt(amount, currency)} ${currency}`;
  return (
    <span className={`text-[10px] tabular-nums ${tone}`} title={title}>
      {curSymbol(currency)}
      {fmt(amount, currency)}
    </span>
  );
}
