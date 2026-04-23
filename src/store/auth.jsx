// src/store/auth.jsx
// Users + их lifecycle (invited → active → disabled).
//
// Модель пользователя:
//   {
//     id, name, initials, email, role, officeId,
//     status: "invited" | "active" | "disabled",
//     passwordHash,         // mock-hash из utils/password.js
//     inviteToken,          // задаётся при create/reset; стирается после activate
//     invitedAt, activatedAt,
//     active,               // КОПИЯ status === "active" для back-compat
//     createdAt,
//   }
//
// Роли (в порядке убывания прав): owner → admin → accountant → manager.
// owner имеет полный доступ и не может быть удалён сам собой (guards в mutations).

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { SEED_USERS } from "./data.js";
import { hashPassword, verifyPassword, generateInviteToken } from "../utils/password.js";
import { supabase, isSupabaseConfigured } from "../lib/supabase.js";
import { loadUsers, loadSystemSettings } from "../lib/supabaseReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";

export const ROLES = {
  owner: { label: "Owner", color: "amber" },
  admin: { label: "Admin", color: "indigo" },
  accountant: { label: "Accountant", color: "emerald" },
  manager: { label: "Manager", color: "slate" },
};

export const ROLE_IDS = Object.keys(ROLES);

function initialsFrom(name) {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] || "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Seed password for demo users (known plaintext = "demo" so Change Password can
// be exercised in the UI без предварительного reset).
const SEED_PASSWORD = "demo";

// Нормализация seed: каждому user'у добавляем status + hash. Существующий
// u_adm по-умолчанию становится owner'ом — ему принадлежит система.
function normalizeSeedUsers(users) {
  return users.map((u) => ({
    ...u,
    role: u.id === "u_adm" ? "owner" : u.role,
    officeId: u.officeId || null,
    status: u.active === false ? "disabled" : "active",
    passwordHash: hashPassword(SEED_PASSWORD),
    inviteToken: "",
    invitedAt: null,
    activatedAt: u.active !== false ? u.createdAt : null,
    active: u.active !== false,
  }));
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUserId, setCurrentUserId] = useState("u_adm");
  // В DB-режиме — пустой список, до момента как loadUsers() заполнит из БД.
  // Избегаем "мигания" seed-юзеров (E.Kara, L.Özturk и др.) на refresh.
  const [users, setUsers] = useState(() =>
    isSupabaseConfigured ? [] : normalizeSeedUsers(SEED_USERS)
  );
  const [settings, setSettings] = useState({
    // DEPRECATED: minFeeUsd теперь per-office (offices[*].minFeeUsd).
    // Оставлено как legacy-fallback на случай если где-то ещё читается.
    // Миграция: существующие офисы получают default = 10 через DEFAULT_OFFICE_OPS.
    minFeeUsd: 10,
    referralPct: 0.1,
    baseCurrency: "USD",
  });

  // Stage 3/4 hydration: Supabase session → public.users row, + reload on bump.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const reload = async () => {
      try {
        const [usersRows, sysSettings, sessionRes] = await Promise.all([
          loadUsers().catch(() => null),
          loadSystemSettings().catch(() => null),
          supabase.auth.getSession().catch(() => ({ data: { session: null } })),
        ]);
        if (cancelled) return;

        if (Array.isArray(usersRows) && usersRows.length > 0) {
          const merged = usersRows.map((u) => ({
            ...u,
            passwordHash: "",
            inviteToken: "",
            invitedAt: u.invitedAt || null,
            activatedAt: u.activatedAt || u.createdAt,
          }));
          setUsers(merged);
          const authUserId = sessionRes?.data?.session?.user?.id;
          if (authUserId && merged.some((u) => u.id === authUserId)) {
            setCurrentUserId(authUserId);
          }
        }

        if (sysSettings) {
          setSettings((prev) => ({
            ...prev,
            referralPct: sysSettings.referralPct || prev.referralPct,
            baseCurrency: sysSettings.baseCurrency || prev.baseCurrency,
            minFeeUsd: sysSettings.minFeeUsd || prev.minFeeUsd,
          }));
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[auth] load failed — keeping seed", err);
      }
    };
    reload();
    const unsub = onDataBump(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Fallback когда users=[] (DB mode, hydration ещё не завершилась).
  // status: "_loading" — сентинель чтобы Root мог отличить hydration-state
  // от реального "active" и не пустил invited-юзера мельком в приложение.
  const currentUser =
    users.find((u) => u.id === currentUserId) ||
    users[0] ||
    {
      id: currentUserId || "",
      name: "Loading…",
      initials: "",
      email: "",
      role: "manager",
      officeId: null,
      status: "_loading",
      active: false,
    };
  const isOwner = currentUser.role === "owner";
  const isAdmin = currentUser.role === "admin" || currentUser.role === "owner"; // owner также считается admin
  const isAccountant = currentUser.role === "accountant";
  const isManager = currentUser.role === "manager";

  // switchUser блокирует invited/disabled. Возвращает {ok, warning?, needsActivation?}.
  const switchUser = useCallback(
    (id) => {
      const target = users.find((u) => u.id === id);
      if (!target) return { ok: false, warning: "user not found" };
      if (target.status === "disabled") {
        return { ok: false, warning: "User is disabled" };
      }
      if (target.status === "invited") {
        return { ok: false, warning: "User not activated yet", needsActivation: true, user: target };
      }
      setCurrentUserId(id);
      return { ok: true };
    },
    [users]
  );

  // Invite: создаёт user'а в статусе "invited", генерирует token.
  // Возвращает {user, inviteToken} — token показывается администратору один раз.
  const createUser = useCallback(
    ({ name, email, role = "manager", officeId = null }) => {
      if (!name?.trim()) return null;
      const token = generateInviteToken();
      const user = {
        id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        name: name.trim(),
        initials: initialsFrom(name),
        email: (email || "").trim(),
        role: ROLES[role] ? role : "manager",
        officeId: officeId || null,
        status: "invited",
        passwordHash: "",
        inviteToken: token,
        invitedAt: new Date().toISOString(),
        activatedAt: null,
        active: true,
        createdAt: new Date().toISOString().slice(0, 10),
      };
      setUsers((prev) => [...prev, user]);
      return { user, inviteToken: token };
    },
    []
  );

  // Совместимость со старым API: добавление с готовым объектом.
  const addUser = useCallback((user) => {
    setUsers((prev) => [
      ...prev,
      {
        status: "active",
        passwordHash: hashPassword(SEED_PASSWORD),
        inviteToken: "",
        invitedAt: null,
        activatedAt: new Date().toISOString(),
        active: true,
        ...user,
      },
    ]);
  }, []);

  const updateUser = useCallback((id, patch) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }, []);

  const updateUserRole = useCallback((id, role) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
  }, []);

  // Activate: перевод invited → active. Опционально проверяем токен.
  const activateUser = useCallback((id, password, tokenOpt) => {
    if (!password || password.length < 4) {
      return { ok: false, warning: "Password must be at least 4 characters" };
    }
    let resp = { ok: true };
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== id) return u;
        if (u.status === "disabled") {
          resp = { ok: false, warning: "User is disabled" };
          return u;
        }
        if (u.status === "active") {
          resp = { ok: false, warning: "User is already active" };
          return u;
        }
        if (tokenOpt && u.inviteToken && u.inviteToken !== tokenOpt) {
          resp = { ok: false, warning: "Invalid invite token" };
          return u;
        }
        return {
          ...u,
          status: "active",
          passwordHash: hashPassword(password),
          inviteToken: "",
          activatedAt: new Date().toISOString(),
          active: true,
        };
      })
    );
    return resp;
  }, []);

  // Change own password (для текущего пользователя).
  const changeOwnPassword = useCallback(
    (oldPass, newPass) => {
      if (!newPass || newPass.length < 4) {
        return { ok: false, warning: "New password must be at least 4 characters" };
      }
      if (!verifyPassword(oldPass, currentUser.passwordHash || "")) {
        return { ok: false, warning: "Current password is incorrect" };
      }
      setUsers((prev) =>
        prev.map((u) =>
          u.id === currentUser.id ? { ...u, passwordHash: hashPassword(newPass) } : u
        )
      );
      return { ok: true };
    },
    [currentUser]
  );

  // Direct password change (admin/owner). В отличие от resetPassword
  // НЕ меняет статус — просто перезаписывает hash. Нельзя ставить пустой.
  const setUserPassword = useCallback(
    (userId, newPass) => {
      if (!newPass || newPass.length < 6) {
        return { ok: false, warning: "Password must be at least 6 characters" };
      }
      let found = false;
      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== userId) return u;
          found = true;
          // Если user был invited — при прямой смене пароля переводим в active.
          const nextStatus = u.status === "disabled" ? u.status : "active";
          return {
            ...u,
            passwordHash: hashPassword(newPass),
            status: nextStatus,
            inviteToken: "",
            activatedAt: u.activatedAt || new Date().toISOString(),
            active: nextStatus !== "disabled",
          };
        })
      );
      if (!found) return { ok: false, warning: "User not found" };
      return { ok: true };
    },
    []
  );

  // Reset password (админ / владелец). Target не может быть текущим пользователем.
  // Возвращает новый inviteToken.
  const resetPassword = useCallback(
    (userId) => {
      if (userId === currentUser.id) {
        return { ok: false, warning: "Use Change Password for your own account" };
      }
      const token = generateInviteToken();
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                status: "invited",
                passwordHash: "",
                inviteToken: token,
                invitedAt: new Date().toISOString(),
                activatedAt: null,
                active: true,
              }
            : u
        )
      );
      return { ok: true, inviteToken: token };
    },
    [currentUser]
  );

  // Disable user. Нельзя отключать себя или последнего owner'а.
  const disableUser = useCallback(
    (userId) => {
      if (userId === currentUser.id) {
        return { ok: false, warning: "Cannot disable your own account" };
      }
      const target = users.find((u) => u.id === userId);
      if (!target) return { ok: false, warning: "User not found" };
      if (target.role === "owner") {
        const otherOwners = users.filter(
          (u) => u.role === "owner" && u.id !== userId && u.status !== "disabled"
        );
        if (otherOwners.length === 0) {
          return { ok: false, warning: "Cannot disable the last owner" };
        }
      }
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, status: "disabled", active: false } : u
        )
      );
      return { ok: true };
    },
    [users, currentUser]
  );

  const enableUser = useCallback((userId) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === userId
          ? { ...u, status: u.passwordHash ? "active" : "invited", active: true }
          : u
      )
    );
    return { ok: true };
  }, []);

  // Back-compat alias'ы старого API (используются в UsersTab старой версии).
  const deactivateUser = disableUser;
  const reactivateUser = enableUser;

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
        // core
        currentUser,
        users,
        settings,
        // role flags
        isOwner,
        isAdmin,
        isAccountant,
        isManager,
        // lifecycle
        switchUser,
        createUser,
        addUser,
        updateUser,
        updateUserRole,
        activateUser,
        changeOwnPassword,
        setUserPassword,
        resetPassword,
        disableUser,
        enableUser,
        deactivateUser,
        reactivateUser,
        // misc
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
