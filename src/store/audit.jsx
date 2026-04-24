// src/store/audit.jsx
// Append-only лог действий. Каждая запись: { id, timestamp, userId, userName, action, entity, entityId, summary, ip }
//
// Использование:
//   const { log } = useAudit();
//   log({ action: "create", entity: "transaction", entityId: tx.id, summary: "USDT 5000 → TRY 194500" });
//
// userId/userName/ip подставляются автоматически из текущего пользователя.
// Store не сам вызывает log из других store'ов — это делают компоненты / страницы в точках мутации.

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { useAuth } from "./auth.jsx";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { loadAuditLog } from "../lib/supabaseReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";
import { insertAuditEntry } from "../lib/supabaseWrite.js";

// IP пользователя: в прод-режиме заполняется на бэкенде (пока не забираем —
// колонка остаётся "" в Supabase insert). В demo — пустая строка для
// единообразия. Убрали mock-IP "78.186.42.17" как артефакт демо-режима.
const CLIENT_IP = "";

const AuditContext = createContext(null);

// Seed — пустой на старте; можно заполнить моками при желании.
const SEED_LOG = [
  {
    id: "evt_seed_1",
    timestamp: new Date(Date.now() - 1000 * 60 * 34).toISOString(),
    userId: "u_adm",
    userName: "E. Kara",
    action: "update",
    entity: "settings",
    entityId: "general",
    summary: "Referral rate changed from 0.05% to 0.1%",
    ip: CLIENT_IP,
  },
  {
    id: "evt_seed_2",
    timestamp: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    userId: "u_adm",
    userName: "E. Kara",
    action: "create",
    entity: "user",
    entityId: "u_acc",
    summary: "Created user L. Özturk (accountant)",
    ip: CLIENT_IP,
  },
];

export function AuditProvider({ children }) {
  const { currentUser } = useAuth();
  const [log, setLogState] = useState(() =>
    isSupabaseConfigured ? [] : SEED_LOG
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const reload = () =>
      loadAuditLog()
        .then((rows) => {
          if (cancelled) return;
          if (Array.isArray(rows)) setLogState(rows);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[audit] load failed", err);
        });
    reload();
    const unsub = onDataBump(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const addEntry = useCallback(
    ({ action, entity, entityId, summary }) => {
      const entry = {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        userId: currentUser?.id || "",
        userName: currentUser?.name || "—",
        action,
        entity,
        entityId: entityId || "",
        summary: summary || "",
        ip: CLIENT_IP,
      };
      setLogState((prev) => [entry, ...prev]);
      // Гонка: rpcCreateDeal etc. дёргает bumpDataVersion → audit reload
      // стартует ПАРАЛЛЕЛЬНО insertAuditEntry. Если reload завершится
      // первым, local optimistic entry стирается (setLogState(rows) —
      // replace), а DB row ещё не закоммичен. Кратковременное моргание.
      // Fix: после insert'а делаем явный reload — финальное состояние
      // синхронизировано с БД.
      if (isSupabaseConfigured) {
        (async () => {
          try {
            await insertAuditEntry({
              action,
              entity,
              entityId,
              summary,
              userId: currentUser?.id || null,
              userName: currentUser?.name || "",
            });
            const rows = await loadAuditLog();
            if (Array.isArray(rows)) setLogState(rows);
          } catch (err) {
            // persist failed — optimistic entry остаётся; UI показал действие
            // eslint-disable-next-line no-console
            console.warn("[audit] persist+reload failed", err);
          }
        })();
      }
      return entry;
    },
    [currentUser]
  );

  const value = useMemo(
    () => ({
      log,
      addEntry,
    }),
    [log, addEntry]
  );

  return <AuditContext.Provider value={value}>{children}</AuditContext.Provider>;
}

export function useAudit() {
  const ctx = useContext(AuditContext);
  if (!ctx) throw new Error("useAudit must be inside AuditProvider");
  return ctx;
}
