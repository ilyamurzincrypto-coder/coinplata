// src/store/clientBalances.js
// Hook для расчёта баланса клиента per currency на основе obligations.
//
// Семантика:
//   we_owe (мы должны клиенту) = +balance (клиент может тратить)
//   they_owe (клиент должен нам) = -balance (overdraft)
//
// Net balance per currency = sum(we_owe.remaining) - sum(they_owe.remaining)
//
// MVP-version: читает obligations из useObligations() hook.
// В Direction 3 (post-cutover) — переключим на ledger.balances.client_id_key.

import { useMemo } from "react";
import { useObligations } from "./obligations.jsx";

export function useClientBalances(clientId) {
  const { obligations } = useObligations();

  return useMemo(() => {
    if (!clientId) return {};
    const map = {};
    for (const o of obligations || []) {
      if (o.clientId !== clientId) continue;
      if (o.status !== "open") continue;
      const remaining = (Number(o.amount) || 0) - (Number(o.paidAmount) || 0);
      const cur = o.currency;
      if (!cur) continue;
      const sign = o.direction === "we_owe" ? 1 : -1;
      map[cur] = (map[cur] || 0) + sign * remaining;
    }
    return map;
  }, [obligations, clientId]);
}
