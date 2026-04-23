// src/store/obligations.jsx
// Obligations — "мы должны" / "нам должны". Открываются когда сделка не может
// быть исполнена сразу (нехватка баланса / контрагент ещё не заплатил).
//
// Инвариант: баланс аккаунта НИКОГДА не уходит в минус. Если средств не хватает —
// OUT movement НЕ создаётся; вместо этого создаётся we_owe obligation и сделка
// переходит в status="pending". Settle конкретной obligation создаёт OUT movement
// и (если у сделки больше нет open-obligations) переводит её в "completed".
//
// Модель идентична backend-таблице obligations (см. migrations/0002_obligations.sql).
//
// Запись:
//   { id, officeId, dealId?, dealLegIndex?, clientId?,
//     currency, amount, direction: 'we_owe'|'they_owe',
//     status: 'open'|'closed'|'cancelled',
//     note, createdAt, createdBy, closedAt?, closedBy? }

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { loadObligations } from "../lib/supabaseReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";

const ObligationsContext = createContext(null);

export function ObligationsProvider({ children }) {
  const [obligations, setObligations] = useState([]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const reload = () =>
      loadObligations()
        .then((rows) => {
          if (cancelled) return;
          if (Array.isArray(rows)) setObligations(rows);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[obligations] load failed", err);
        });
    reload();
    const unsub = onDataBump(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const addObligation = useCallback((input) => {
    const rec = {
      id: `ob_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      officeId: input.officeId,
      dealId: input.dealId ?? null,
      dealLegIndex: Number.isFinite(input.dealLegIndex) ? input.dealLegIndex : null,
      clientId: input.clientId ?? null,
      currency: input.currency,
      amount: Math.abs(Number(input.amount) || 0),
      direction: input.direction === "they_owe" ? "they_owe" : "we_owe",
      status: "open",
      note: input.note || "",
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy || null,
      closedAt: null,
      closedBy: null,
    };
    setObligations((prev) => [rec, ...prev]);
    return rec;
  }, []);

  const closeObligation = useCallback((id, closedBy) => {
    setObligations((prev) =>
      prev.map((o) =>
        o.id === id
          ? { ...o, status: "closed", closedAt: new Date().toISOString(), closedBy: closedBy || null }
          : o
      )
    );
  }, []);

  const cancelObligation = useCallback((id, closedBy) => {
    setObligations((prev) =>
      prev.map((o) =>
        o.id === id
          ? { ...o, status: "cancelled", closedAt: new Date().toISOString(), closedBy: closedBy || null }
          : o
      )
    );
  }, []);

  const removeByDealId = useCallback((dealId) => {
    setObligations((prev) => prev.filter((o) => o.dealId !== dealId));
  }, []);

  // Открытые we_owe по (officeId, currency) — уменьшают доступный баланс.
  const openWeOweByOfficeCurrency = useCallback(
    (officeId, currency) =>
      obligations
        .filter(
          (o) =>
            o.status === "open" &&
            o.direction === "we_owe" &&
            o.officeId === officeId &&
            o.currency === currency
        )
        .reduce((s, o) => s + o.amount, 0),
    [obligations]
  );

  // Открытые they_owe по (officeId, currency) — deferred приход.
  const openTheyOweByOfficeCurrency = useCallback(
    (officeId, currency) =>
      obligations
        .filter(
          (o) =>
            o.status === "open" &&
            o.direction === "they_owe" &&
            o.officeId === officeId &&
            o.currency === currency
        )
        .reduce((s, o) => s + o.amount, 0),
    [obligations]
  );

  const byDealId = useCallback(
    (dealId) => obligations.filter((o) => o.dealId === dealId),
    [obligations]
  );

  const openCount = useMemo(
    () => obligations.filter((o) => o.status === "open").length,
    [obligations]
  );

  const openTotal = useMemo(() => {
    // Сумма по всем открытым we_owe — агрегируется в base currency вызывающим кодом.
    const map = new Map();
    obligations.forEach((o) => {
      if (o.status !== "open" || o.direction !== "we_owe") return;
      const key = `${o.officeId}|${o.currency}`;
      map.set(key, (map.get(key) || 0) + o.amount);
    });
    return map;
  }, [obligations]);

  const value = useMemo(
    () => ({
      obligations,
      addObligation,
      closeObligation,
      cancelObligation,
      removeByDealId,
      openWeOweByOfficeCurrency,
      openTheyOweByOfficeCurrency,
      byDealId,
      openCount,
      openTotal,
    }),
    [
      obligations,
      addObligation,
      closeObligation,
      cancelObligation,
      removeByDealId,
      openWeOweByOfficeCurrency,
      openTheyOweByOfficeCurrency,
      byDealId,
      openCount,
      openTotal,
    ]
  );

  return (
    <ObligationsContext.Provider value={value}>{children}</ObligationsContext.Provider>
  );
}

export function useObligations() {
  const ctx = useContext(ObligationsContext);
  if (!ctx) throw new Error("useObligations must be inside ObligationsProvider");
  return ctx;
}
