// src/store/accounts.jsx
// Store счетов/кошельков обменника. Привязаны к office + currency.
// Используется в ExchangeForm для выбора "куда получили" и в будущем Capital для разбивки.

import { createContext, useContext, useState, useCallback, useMemo } from "react";
import { SEED_ACCOUNTS, ACCOUNT_TYPES } from "./data.js";

const AccountsContext = createContext(null);

export function AccountsProvider({ children }) {
  const [accounts, setAccounts] = useState(SEED_ACCOUNTS);

  const addAccount = useCallback((acc) => {
    setAccounts((prev) => [
      ...prev,
      { id: `a_${Date.now()}`, active: true, ...acc },
    ]);
  }, []);

  const updateAccount = useCallback((id, patch) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  const deactivateAccount = useCallback((id) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, active: false } : a)));
  }, []);

  // Фильтрация
  const accountsByOffice = useCallback(
    (officeId, { currency, activeOnly = true } = {}) => {
      return accounts.filter(
        (a) =>
          a.officeId === officeId &&
          (!currency || a.currency === currency) &&
          (!activeOnly || a.active)
      );
    },
    [accounts]
  );

  const findAccount = useCallback(
    (id) => accounts.find((a) => a.id === id),
    [accounts]
  );

  const value = useMemo(
    () => ({
      accounts,
      accountTypes: ACCOUNT_TYPES,
      addAccount,
      updateAccount,
      deactivateAccount,
      accountsByOffice,
      findAccount,
    }),
    [accounts, addAccount, updateAccount, deactivateAccount, accountsByOffice, findAccount]
  );

  return <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>;
}

export function useAccounts() {
  const ctx = useContext(AccountsContext);
  if (!ctx) throw new Error("useAccounts must be inside AccountsProvider");
  return ctx;
}
