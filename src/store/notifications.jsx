// src/store/notifications.jsx
// Накопительный лог уведомлений. Рендерится в Header через NotificationsBell.
//
// Источники событий (через supabase realtime):
//   • pairs UPDATE          → type="rate_change"
//   • deals INSERT pending  → type="new_pending"
//   • obligations INSERT    → type="new_obligation"
//
// Storage: in-memory + localStorage (последние 50 записей).
// При refresh страницы — история сохраняется (в отличие от RateChangeBanner).
//
// API:
//   const { notifications, unreadCount, markAllRead, clearAll, addLocal } = useNotifications();

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase.js";
import { useAuth } from "./auth.jsx";

const STORAGE_KEY = "coinplata.notifications";
const MAX_ITEMS = 50;

const NotificationsContext = createContext(null);

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function saveToStorage(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // quota exceeded / disabled — молча игнорируем
  }
}

export function NotificationsProvider({ children }) {
  const { currentUser, users } = useAuth();
  const [notifications, setNotifications] = useState(() => loadFromStorage());
  // Храним ref на текущего пользователя для callback'ов realtime — чтобы не
  // пересоздавать подписку каждый раз когда currentUser меняется (и не
  // терять сообщения в этот момент).
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const usersRef = useRef(users);
  usersRef.current = users;

  const pushNotification = useCallback((note) => {
    setNotifications((prev) => {
      const rec = {
        id: note.id || `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: note.createdAt || new Date().toISOString(),
        readAt: null,
        ...note,
      };
      const next = [rec, ...prev].slice(0, MAX_ITEMS);
      saveToStorage(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const now = new Date().toISOString();
      const next = prev.map((n) => (n.readAt ? n : { ...n, readAt: now }));
      saveToStorage(next);
      return next;
    });
  }, []);

  const markOneRead = useCallback((id) => {
    setNotifications((prev) => {
      const now = new Date().toISOString();
      const next = prev.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: now } : n));
      saveToStorage(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setNotifications(() => {
      saveToStorage([]);
      return [];
    });
  }, []);

  // --- Realtime subscriptions ---
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    // 1) pairs UPDATE → rate_change
    const pairsCh = supabase
      .channel("cp-notif-pairs")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "pairs" },
        (payload) => {
          const row = payload.new || {};
          const old = payload.old || {};
          // Свои изменения не показываем
          if (row.updated_by && row.updated_by === currentUserRef.current?.id) return;
          const newRate = Number(row.rate);
          const oldRate = Number(old.rate);
          if (Number.isFinite(newRate) && Number.isFinite(oldRate) && Math.abs(newRate - oldRate) < 1e-9) return;
          const by = (usersRef.current || []).find((u) => u.id === row.updated_by);
          pushNotification({
            type: "rate_change",
            title: `${row.from_currency} → ${row.to_currency}`,
            body: `${oldRate ? oldRate.toFixed(4) : "?"} → ${newRate.toFixed(4)} by ${by?.name || "someone"}`,
          });
        }
      )
      .subscribe();

    // 2) deals INSERT — два случая:
    //    a) "Назначено мне" — manager_id === current и created_by_user_id !== current
    //       (admin/owner создал сделку от моего имени) → ВСЕГДА уведомление,
    //       не зависит от status. Это P2P-логика: менеджер должен узнать что
    //       за ним закрепили деал.
    //    b) Pending/checking от чужого менеджера (старая логика для accountant'ов
    //       которые мониторят пайплайн). Свои не показываем.
    const dealsCh = supabase
      .channel("cp-notif-deals")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "deals" },
        (payload) => {
          const row = payload.new || {};
          const me = currentUserRef.current?.id;
          if (!me) return;
          const assignedToMe =
            row.manager_id === me &&
            row.created_by_user_id &&
            row.created_by_user_id !== me;
          if (assignedToMe) {
            const creator = (usersRef.current || []).find((u) => u.id === row.created_by_user_id);
            pushNotification({
              type: "deal_assigned",
              title: `На вас назначена сделка #${row.id}`,
              body: `${row.amount_in} ${row.currency_in} · от ${creator?.name || "admin"}`,
              link: "cashier",
            });
            return;
          }
          // Старый кейс: pending/checking чужой сделки
          if (row.manager_id === me) return; // свои не показываем
          if (row.status !== "pending" && row.status !== "checking") return;
          const by = (usersRef.current || []).find((u) => u.id === row.manager_id);
          pushNotification({
            type: "new_pending",
            title: `New ${row.status} deal #${row.id}`,
            body: `${row.amount_in} ${row.currency_in} · by ${by?.name || "someone"}`,
            link: "cashier",
          });
        }
      )
      .subscribe();

    // 2b) transfers INSERT pending — interoffice P2P transfer.
    //     Получатель (to_manager_id) видит уведомление "ожидает подтверждения".
    const transfersCh = supabase
      .channel("cp-notif-transfers")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "transfers" },
        (payload) => {
          const row = payload.new || {};
          const me = currentUserRef.current?.id;
          if (!me) return;
          if (row.status !== "pending") return;
          if (row.to_manager_id !== me) return;
          const sender = (usersRef.current || []).find((u) => u.id === row.created_by);
          pushNotification({
            type: "transfer_pending",
            title: `Входящий перевод`,
            body: `Ожидает подтверждения · от ${sender?.name || "коллеги"}`,
            link: "cashier",
          });
        }
      )
      .subscribe();

    // 3) obligations INSERT
    const obCh = supabase
      .channel("cp-notif-obligations")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "obligations" },
        (payload) => {
          const row = payload.new || {};
          if (row.created_by && row.created_by === currentUserRef.current?.id) return;
          const dir = row.direction === "we_owe" ? "We owe" : "They owe";
          pushNotification({
            type: "new_obligation",
            title: `${dir} · ${row.currency_code}`,
            body: `${row.amount} ${row.currency_code}${row.deal_id ? ` · deal #${row.deal_id}` : ""}`,
            link: "obligations",
          });
        }
      )
      .subscribe();

    return () => {
      try { supabase.removeChannel(pairsCh); } catch {}
      try { supabase.removeChannel(dealsCh); } catch {}
      try { supabase.removeChannel(transfersCh); } catch {}
      try { supabase.removeChannel(obCh); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.readAt).length,
    [notifications]
  );

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      pushNotification,
      markAllRead,
      markOneRead,
      clearAll,
    }),
    [notifications, unreadCount, pushNotification, markAllRead, markOneRead, clearAll]
  );

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be inside NotificationsProvider");
  return ctx;
}
