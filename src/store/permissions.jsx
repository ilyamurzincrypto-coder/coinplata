// src/store/permissions.jsx
// Матрица прав: {[userId]: {[section]: level}}
// Уровни: "disabled" | "view" | "edit"
// Разделы: transactions, capital, accounts, settings, referrals, income_expense, audit
//
// Дефолты по роли:
//   admin       — везде edit
//   manager     — transactions: edit (свои; в canEditTransaction это доп.), capital: view
//                 referrals: view, accounts: view, settings: disabled, income_expense: disabled
//   accountant  — transactions: view, capital: edit, income_expense: edit, accounts: edit,
//                 settings: view, referrals: view

import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { useAuth } from "./auth.jsx";

export const SECTIONS = [
  "transactions",
  "capital",
  "accounts",
  "referrals",
  "income_expense",
  "settings",
  "audit",
];

export const LEVELS = ["disabled", "view", "edit"];

// Порядок: edit > view > disabled
const LEVEL_RANK = { disabled: 0, view: 1, edit: 2 };

const ROLE_DEFAULTS = {
  admin: {
    transactions: "edit",
    capital: "edit",
    accounts: "edit",
    referrals: "edit",
    income_expense: "edit",
    settings: "edit",
    audit: "edit",
  },
  manager: {
    transactions: "edit",
    capital: "view",
    accounts: "view",
    referrals: "view",
    income_expense: "disabled",
    settings: "disabled",
    audit: "disabled",
  },
  accountant: {
    transactions: "view",
    capital: "edit",
    accounts: "edit",
    referrals: "view",
    income_expense: "edit",
    settings: "view",
    audit: "view",
  },
};

export function defaultPermissionsForRole(role) {
  return { ...(ROLE_DEFAULTS[role] || ROLE_DEFAULTS.manager) };
}

const PermissionsContext = createContext(null);

export function PermissionsProvider({ children }) {
  const { users } = useAuth();
  // Инициализируем matrix дефолтами по ролям
  const [overrides, setOverrides] = useState({});

  const getPermissions = useCallback(
    (userId) => {
      const user = users.find((u) => u.id === userId);
      if (!user) return {};
      const base = defaultPermissionsForRole(user.role);
      const userOverrides = overrides[userId] || {};
      return { ...base, ...userOverrides };
    },
    [users, overrides]
  );

  const setPermission = useCallback((userId, section, level) => {
    setOverrides((prev) => ({
      ...prev,
      [userId]: { ...(prev[userId] || {}), [section]: level },
    }));
  }, []);

  const resetUserPermissions = useCallback((userId) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ getPermissions, setPermission, resetUserPermissions }),
    [getPermissions, setPermission, resetUserPermissions]
  );

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error("usePermissions must be inside PermissionsProvider");
  return ctx;
}

// Удобный хелпер для текущего пользователя
export function useCan() {
  const { currentUser } = useAuth();
  const { getPermissions } = usePermissions();
  const perms = getPermissions(currentUser.id);

  // can("section") — true если level >= "view"
  // can("section", "edit") — true если level == "edit"
  return useCallback(
    (section, required = "view") => {
      const level = perms[section] || "disabled";
      return LEVEL_RANK[level] >= LEVEL_RANK[required];
    },
    [perms]
  );
}
