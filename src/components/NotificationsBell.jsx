// src/components/NotificationsBell.jsx
// Bell-иконка с dropdown в Header. Показывает список уведомлений из
// useNotifications(). Unread badge, mark-all-read, clear-all, нажатие на
// строку с link → navigation.

import React, { useEffect, useRef, useState } from "react";
import {
  Bell,
  TrendingUp,
  Clock,
  Scale,
  Check,
  Trash2,
  X,
} from "lucide-react";
import { useNotifications } from "../store/notifications.jsx";

function timeAgo(iso) {
  const t = new Date(iso).getTime();
  const diff = Math.floor((Date.now() - t) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

const TYPE_ICON = {
  rate_change: <TrendingUp className="w-3.5 h-3.5" />,
  new_pending: <Clock className="w-3.5 h-3.5" />,
  new_obligation: <Scale className="w-3.5 h-3.5" />,
};

const TYPE_TONE = {
  rate_change: "bg-amber-100 text-amber-700",
  new_pending: "bg-sky-100 text-sky-700",
  new_obligation: "bg-rose-100 text-rose-700",
};

export default function NotificationsBell({ onNavigate }) {
  const { notifications, unreadCount, markAllRead, markOneRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Закрывать по клику снаружи
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const handleOpen = () => {
    setOpen((prev) => !prev);
    // Mark-all не делаем автоматически — пусть пользователь решит
  };

  const handleRowClick = (n) => {
    if (!n.readAt) markOneRead(n.id);
    if (n.link && onNavigate) {
      onNavigate(n.link);
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={handleOpen}
        className="relative inline-flex items-center justify-center w-8 h-8 rounded-[10px] text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
        title="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold tabular-nums">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[360px] bg-white rounded-[12px] border border-slate-200 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.25)] z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="text-[13px] font-bold text-slate-900">
              Notifications
              {unreadCount > 0 && (
                <span className="ml-1.5 text-[11px] font-semibold text-rose-600">
                  {unreadCount} unread
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  title="Mark all as read"
                >
                  <Check className="w-3 h-3" />
                  Mark read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                  title="Clear all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="max-h-[400px] overflow-auto">
            {notifications.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <Bell className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <div className="text-[13px] text-slate-500 font-semibold">No notifications yet</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Rate changes and team activity will appear here
                </div>
              </div>
            ) : (
              notifications.map((n) => {
                const isUnread = !n.readAt;
                const icon = TYPE_ICON[n.type] || <Bell className="w-3.5 h-3.5" />;
                const tone = TYPE_TONE[n.type] || "bg-slate-100 text-slate-700";
                return (
                  <button
                    key={n.id}
                    onClick={() => handleRowClick(n)}
                    className={`w-full flex items-start gap-2.5 px-4 py-2.5 text-left border-b border-slate-100 last:border-0 transition-colors ${
                      isUnread ? "bg-sky-50/40 hover:bg-sky-50" : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${tone} shrink-0 mt-0.5`}
                    >
                      {icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-bold text-slate-900 truncate">
                          {n.title}
                        </span>
                        {isUnread && (
                          <span className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" />
                        )}
                      </div>
                      <div className="text-[11px] text-slate-600 truncate mt-0.5">{n.body}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                        {timeAgo(n.createdAt)} ago
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
