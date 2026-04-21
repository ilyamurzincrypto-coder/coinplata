// src/store/incomeExpense.jsx
// Записи доходов и расходов, НЕ связанные со сделками обмена.
// Сделки из transactions.jsx уже генерируют profit — это своя метрика.
// Здесь — аренда офиса, зарплаты, bonuses, штрафы, пополнения сейфа и т.д.
//
// Запись: { id, type, officeId, accountId, category, amount, currency, date, note, createdBy }

import { createContext, useContext, useState, useCallback, useMemo } from "react";

export const IE_TYPES = ["income", "expense"];

export const IE_CATEGORIES = {
  income: ["Capital injection", "Interest", "Other income", "Partner deposit"],
  expense: ["Office rent", "Salary", "Utilities", "Marketing", "Tax", "Equipment", "Other"],
};

// Seed — несколько записей, чтобы Cashflow таб не был пустым.
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const SEED_IE = [
  { id: "ie_1", type: "expense", officeId: "mark", accountId: "a_mark_cash_try", category: "Office rent", amount: 42000, currency: "TRY", date: daysAgo(4), note: "April", createdBy: "u_adm" },
  { id: "ie_2", type: "expense", officeId: "mark", accountId: "a_mark_cash_try", category: "Salary", amount: 85000, currency: "TRY", date: daysAgo(4), note: "3 employees", createdBy: "u_adm" },
  { id: "ie_3", type: "expense", officeId: "ist", accountId: "a_ist_cash_eur", category: "Utilities", amount: 320, currency: "EUR", date: daysAgo(6), note: "Electricity", createdBy: "u_adm" },
  { id: "ie_4", type: "income", officeId: "mark", accountId: "a_mark_crypto_usdt", category: "Partner deposit", amount: 25000, currency: "USDT", date: daysAgo(2), note: "Top-up from HQ", createdBy: "u_adm" },
  { id: "ie_5", type: "expense", officeId: "terra", accountId: "a_terra_cash_usd", category: "Marketing", amount: 600, currency: "USD", date: daysAgo(8), note: "Ads", createdBy: "u_adm" },
  { id: "ie_6", type: "income", officeId: "ist", accountId: "a_ist_bank_usd", category: "Interest", amount: 420, currency: "USD", date: daysAgo(1), note: "Bank interest", createdBy: "u_adm" },
];

const IEContext = createContext(null);

export function IncomeExpenseProvider({ children }) {
  const [entries, setEntries] = useState(SEED_IE);

  const addEntry = useCallback((entry) => {
    const full = {
      id: `ie_${Date.now()}`,
      date: today(),
      ...entry,
    };
    setEntries((prev) => [full, ...prev]);
    return full;
  }, []);

  const updateEntry = useCallback((id, patch) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const deleteEntry = useCallback((id) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const value = useMemo(
    () => ({ entries, addEntry, updateEntry, deleteEntry }),
    [entries, addEntry, updateEntry, deleteEntry]
  );

  return <IEContext.Provider value={value}>{children}</IEContext.Provider>;
}

export function useIncomeExpense() {
  const ctx = useContext(IEContext);
  if (!ctx) throw new Error("useIncomeExpense must be inside IncomeExpenseProvider");
  return ctx;
}
