// src/store/transactions.js
// Общий store транзакций, чтобы Cashier / Capital / Referrals видели одни и те же данные.

import { createContext, useContext, useState, useCallback } from "react";
import { SEED_TX, SEED_COUNTERPARTIES } from "./data.js";

const TxContext = createContext(null);

export function TransactionsProvider({ children }) {
  const [transactions, setTransactions] = useState(SEED_TX);
  const [counterparties, setCounterparties] = useState(SEED_COUNTERPARTIES);

  const addTransaction = useCallback((tx) => {
    setTransactions((prev) => [tx, ...prev]);
  }, []);

  const updateTransaction = useCallback((id, patch) => {
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
  }, []);

  const addCounterparty = useCallback((nickname) => {
    if (!nickname) return;
    setCounterparties((prev) => {
      if (prev.some((c) => c.nickname.toLowerCase() === nickname.toLowerCase())) {
        return prev;
      }
      return [...prev, { id: `cp_${Date.now()}`, nickname }];
    });
  }, []);

  return (
    <TxContext.Provider
      value={{
        transactions,
        counterparties,
        addTransaction,
        updateTransaction,
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
