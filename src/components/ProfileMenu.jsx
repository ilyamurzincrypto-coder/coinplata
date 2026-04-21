// src/components/ProfileMenu.jsx
// Dropdown у аватара в Header: change photo / change password / logout.
// Все действия — заглушки (alert), реальная интеграция — в следующей фазе.

import React, { useState, useRef, useEffect } from "react";
import { Camera, Key, LogOut, ShieldCheck, ChevronDown } from "lucide-react";
import { useAuth } from "../store/auth.jsx";
import { useTranslation } from "../i18n/translations.jsx";

export default function ProfileMenu() {
  const { t } = useTranslation();
  const { currentUser, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const stub = (msg) => {
    setOpen(false);
    alert(msg + " — will be wired to backend in next release.");
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 pl-2 py-1 pr-2 rounded-[10px] hover:bg-slate-50 transition-colors"
      >
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-semibold ${
            isAdmin
              ? "bg-gradient-to-br from-indigo-500 to-indigo-700"
              : "bg-gradient-to-br from-slate-700 to-slate-900"
          }`}
        >
          {currentUser.initials}
        </div>
        <div className="hidden sm:block text-[12px] leading-tight text-left">
          <div className="font-medium text-slate-900">{currentUser.name}</div>
          <div className="text-slate-500 flex items-center gap-1">
            {isAdmin && <ShieldCheck className="w-2.5 h-2.5 text-indigo-500" />}
            {isAdmin ? t("admin") : t("manager")}
          </div>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 hidden sm:block transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-60 bg-white border border-slate-200 rounded-[12px] shadow-[0_16px_40px_-12px_rgba(15,23,42,0.25)] overflow-hidden animate-[fadeIn_120ms_ease-out]">
          <div className="px-4 py-3 border-b border-slate-100">
            <div className="text-[13px] font-semibold text-slate-900">{currentUser.name}</div>
            <div className="text-[11px] text-slate-500">{currentUser.role === "admin" ? t("admin") : t("manager")}</div>
          </div>
          <div className="py-1">
            <MenuItem icon={<Camera className="w-3.5 h-3.5" />} onClick={() => stub(t("change_photo"))}>
              {t("change_photo")}
            </MenuItem>
            <MenuItem icon={<Key className="w-3.5 h-3.5" />} onClick={() => stub(t("change_password"))}>
              {t("change_password")}
            </MenuItem>
          </div>
          <div className="py-1 border-t border-slate-100">
            <MenuItem
              icon={<LogOut className="w-3.5 h-3.5" />}
              onClick={() => stub(t("logout"))}
              danger
            >
              {t("logout")}
            </MenuItem>
          </div>
        </div>
      )}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-left transition-colors ${
        danger ? "text-rose-600 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
