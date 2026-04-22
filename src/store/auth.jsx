// src/store/auth.jsx
// Аутентификация, пользователи, системные настройки.
// В фазе 2 добавлены:
//   — роль accountant
//   — поле active (dismiss employee)
//   — createUser с mock password generation
//   — deactivateUser / reactivateUser
//   — helper `ROLES` для использования в UI

import { createContext, useContext, useState, useCallback } from "react";
import { SEED_USERS } from "./data.js";

export const ROLES = {
  admin: { label: "Admin", color: "indigo" },
  manager: { label: "Manager", color: "slate" },
  accountant: { label: "Accountant", color: "emerald" },
};

export const ROLE_IDS = Object.keys(ROLES);

// Mock password generator (в проде — через backend)
function generatePassword(length = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

// Простая генерация инициалов из имени
function initialsFrom(name) {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] || "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUserId, setCurrentUserId] = useState("u_adm");
  const [users, setUsers] = useState(SEED_USERS);
  const [settings, setSettings] = useState({
    minFeeUsd: 10,
    referralPct: 0.1,
    baseCurrency: "USD", // используется для агрегированных метрик: capital, dashboard, LTV
  });

  const currentUser = users.find((u) => u.id === currentUserId) || users[0];
  const isAdmin = currentUser.role === "admin";
  const isAccountant = currentUser.role === "accountant";
  const isManager = currentUser.role === "manager";

  const switchUser = useCallback((id) => setCurrentUserId(id), []);

  // Полноценное создание пользователя с паролем
  const createUser = useCallback(({ name, email, role = "manager" }) => {
    if (!name?.trim()) return null;
    const password = generatePassword();
    const user = {
      id: `u_${Date.now()}`,
      name: name.trim(),
      initials: initialsFrom(name),
      email: (email || "").trim(),
      role,
      active: true,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    setUsers((prev) => [...prev, user]);
    // Возвращаем пользователя + сгенерированный пароль (показать один раз).
    return { user, password };
  }, []);

  // Обратная совместимость со старым API
  const addUser = useCallback((user) => {
    setUsers((prev) => [...prev, { active: true, ...user }]);
  }, []);

  const updateUser = useCallback((id, patch) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }, []);

  const updateUserRole = useCallback((id, role) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
  }, []);

  const deactivateUser = useCallback((id) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, active: false } : u)));
  }, []);

  const reactivateUser = useCallback((id) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, active: true } : u)));
  }, []);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

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
        isAccountant,
        isManager,
        users,
        settings,
        switchUser,
        createUser,
        addUser,
        updateUser,
        updateUserRole,
        deactivateUser,
        reactivateUser,
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
