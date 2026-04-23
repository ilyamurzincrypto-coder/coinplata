// src/lib/toast.jsx
// Минимальный toast-механизм: queue на ~3 элемента, автодисмисс 4с.
// API: useToast().success(msg) / .error(msg) / .info(msg).
//
// В writer-хелперах (вне React) используем window-событие как fallback —
// ToastProvider на mount подписывается. Это позволяет тоcтить из любого
// модуля без таскания useContext через вызовы.

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";

const ToastContext = createContext(null);
const TOAST_EVENT = "coinplata:toast";

export function emitToast(kind, text) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TOAST_EVENT, { detail: { kind, text } })
  );
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const push = useCallback((kind, text) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, text }].slice(-5));
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const { kind, text } = e.detail || {};
      if (text) push(kind || "info", String(text));
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, [push]);

  const api = {
    success: (t) => push("success", t),
    error: (t) => push("error", t),
    info: (t) => push("info", t),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {items.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2.5 rounded-lg text-[13px] shadow-lg pointer-events-auto min-w-[240px] max-w-[360px] ${
              t.kind === "error"
                ? "bg-red-600 text-white"
                : t.kind === "success"
                ? "bg-emerald-600 text-white"
                : "bg-slate-900 text-white"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext) || {
    success: (t) => emitToast("success", t),
    error: (t) => emitToast("error", t),
    info: (t) => emitToast("info", t),
  };
}
