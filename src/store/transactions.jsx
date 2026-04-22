// src/store/transactions.js
// Общий store транзакций, чтобы Cashier / Capital / Referrals видели одни и те же данные.

import { createContext, useContext, useState, useCallback } from "react";
import { SEED_TX, SEED_COUNTERPARTIES } from "./data.js";

const TxContext = createContext(null);

export function TransactionsProvider({ children }) {
  const [transactions, setTransactions] = useState(SEED_TX);
  const [counterparties, setCounterparties] = useState(SEED_COUNTERPARTIES);

  const addTransaction = useCallback((tx) => {
    // status defaults to "completed" для полной обратной совместимости
    const full = { status: "completed", ...tx };
    setTransactions((prev) => [full, ...prev]);
  }, []);

  const updateTransaction = useCallback((id, patch) => {
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
  }, []);

  // Перевод pending → completed (только меняет статус в store;
  // запись movements остаётся задачей вызывающего кода, т.к. мы не должны
  // знать про accounts store из transactions).
  const completeTransaction = useCallback((id) => {
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: "completed" } : t))
    );
  }, []);

  // Принимает либо строку nickname (обратная совместимость),
  // либо объект { nickname, name, telegram }. Возвращает созданного/существующего контрагента.
  const addCounterparty = useCallback((input) => {
    if (!input) return null;
    const data = typeof input === "string"
      ? { nickname: input, name: "", telegram: "" }
      : { nickname: input.nickname || input.name || "", name: input.name || "", telegram: input.telegram || "" };
    if (!data.nickname) return null;

    let result = null;
    setCounterparties((prev) => {
      const existing = prev.find(
        (c) => c.nickname.toLowerCase() === data.nickname.toLowerCase()
      );
      if (existing) {
        result = existing;
        return prev;
      }
      const created = { id: `cp_${Date.now()}`, ...data };
      result = created;
      return [...prev, created];
    });
    return result;
  }, []);

  return (
    <TxContext.Provider
      value={{
        transactions,
        counterparties,
        addTransaction,
        updateTransaction,
        completeTransaction,
        addCounterparty,
      }}
    >
      {children}
    </TxContext.Provider>
  );
}

export function useTransactions() {
  const ctx = useContext(TxContext);
  if (!ctx) throw new Error("useTransactions must be inside TransactionsProvider");
  return ctx;
}
