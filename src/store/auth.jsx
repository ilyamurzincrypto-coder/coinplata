// src/store/auth.js
// Текущий пользователь и системные настройки (min fee, referral %).
// В проде роль придёт с backend/JWT — здесь это мок для демо.

import { createContext, useContext, useState, useCallback } from "react";
import { SEED_USERS } from "./data.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // По умолчанию логиним админа, чтобы видеть всю функциональность.
  const [currentUserId, setCurrentUserId] = useState("u_adm");
  const [users, setUsers] = useState(SEED_USERS);
  const [settings, setSettings] = useState({
    minFeeUsd: 10,
    referralPct: 0.1, // 0.1%
  });

  const currentUser = users.find((u) => u.id === currentUserId) || users[0];
  const isAdmin = currentUser.role === "admin";

  const switchUser = useCallback((id) => setCurrentUserId(id), []);

  const addUser = useCallback((user) => {
    setUsers((prev) => [...prev, user]);
  }, []);

  const updateUserRole = useCallback((id, role) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
  }, []);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // Проверка: может ли текущий пользователь редактировать транзакцию
  const canEditTransaction = useCallback(
    (tx) => {
      if (!tx) return false;
      if (isAdmin) return true;
      return tx.managerId === currentUser.id;
    },
    [isAdmin, currentUser.id]
  );

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAdmin,
        users,
        settings,
        switchUser,
        addUser,
        updateUserRole,
        updateSettings,
        canEditTransaction,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
