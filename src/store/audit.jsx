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

// Мок IP — в проде берём из session/headers
const MOCK_IP = "78.186.42.17";

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
    ip: MOCK_IP,
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
    ip: MOCK_IP,
  },
];

export function AuditProvider({ children }) {
  const { currentUser } = useAuth();
  const [log, setLogState] = useState(SEED_LOG);

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
        userId: currentUser.id,
        userName: currentUser.name,
        action,
        entity,
        entityId: entityId || "",
        summary: summary || "",
        ip: MOCK_IP,
      };
      setLogState((prev) => [entry, ...prev]);
      // Fire-and-forget persist в БД. Не bump-им — audit не влияет на
      // остальные stores, записи подтянутся при следующем reload.
      insertAuditEntry({ action, entity, entityId, summary });
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
