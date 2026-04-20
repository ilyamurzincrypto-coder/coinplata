// src/components/Header.jsx
import React from "react";
import { Globe } from "lucide-react";
import SegmentedControl from "./ui/SegmentedControl.jsx";
import Select from "./ui/Select.jsx";
import { OFFICES } from "../store/data.js";
import { useTranslation } from "../i18n/translations.jsx";
import { useAuth } from "../store/auth.jsx";

const NAV_PAGES = [
  { id: "cashier", key: "nav_cashier" },
  { id: "capital", key: "nav_capital" },
  { id: "referrals", key: "nav_referrals" },
  { id: "settings", key: "nav_settings" },
];

export default function Header({ currentOffice, onOfficeChange, page, onPageChange }) {
  const { t, lang, setLang } = useTranslation();
  const { currentUser, isAdmin, users, switchUser } = useAuth();

  return (
    <header className="sticky top-0 z-40 bg-white/85 backdrop-blur-xl border-b border-slate-200/70">
      <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-[8px] bg-slate-900 flex items-center justify-center">
              <div className="w-3 h-3 rounded-[3px] bg-gradient-to-br from-emerald-300 to-emerald-500" />
            </div>
            <span className="text-[15px] font-semibold tracking-tight">CoinPlata</span>
          </div>

          <nav className="hidden lg:flex items-center gap-0.5">
            {NAV_PAGES.map((p) => (
              <button
                key={p.id}
                onClick={() => onPageChange(p.id)}
                className={`px-3 py-1.5 rounded-[8px] text-[13px] transition-colors ${
                  page === p.id
                    ? "bg-slate-100 text-slate-900 font-medium"
                    : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                {t(p.key)}
              </button>
            ))}
          </nav>

          <div className="hidden md:block h-5 w-px bg-slate-200" />

          {/* Office switcher only on Cashier page */}
          {page === "cashier" && (
            <div className="hidden md:block">
              <SegmentedControl options={OFFICES} value={currentOffice} onChange={onOfficeChange} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="w-20">
            <Select
              value={lang}
              onChange={setLang}
              options={["EN", "RU", "TR"]}
              icon={<Globe className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
              compact
            />
          </div>

          {/* Role demo switcher */}
          <div className="w-40 hidden sm:block">
            <Select
              value={currentUser.id}
              onChange={(v) => switchUser(v)}
              options={users.map((u) => u.id)}
              compact
              renderOption={(id) => {
                const u = users.find((x) => x.id === id);
                return u ? `${u.name} · ${u.role === "admin" ? t("admin") : t("manager")}` : id;
              }}
            />
          </div>

          <div className="flex items-center gap-2 pl-2 ml-1 border-l border-slate-200">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-semibold ${
                isAdmin
                  ? "bg-gradient-to-br from-indigo-500 to-indigo-700"
                  : "bg-gradient-to-br from-slate-700 to-slate-900"
              }`}
            >
              {currentUser.initials}
            </div>
            <div className="hidden sm:block text-[12px] leading-tight">
              <div className="font-medium text-slate-900">{currentUser.name}</div>
              <div className="text-slate-500 capitalize">
                {isAdmin ? t("admin") : t("manager")}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile nav */}
      <div className="lg:hidden px-4 pb-2 pt-1 flex items-center gap-2 overflow-x-auto">
        {NAV_PAGES.map((p) => (
          <button
            key={p.id}
            onClick={() => onPageChange(p.id)}
            className={`px-3 py-1 rounded-[8px] text-[12px] whitespace-nowrap transition-colors ${
              page === p.id
                ? "bg-slate-100 text-slate-900 font-medium"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {t(p.key)}
          </button>
        ))}
      </div>

      {/* Mobile office switcher */}
      {page === "cashier" && (
        <div className="md:hidden px-4 pb-3 pt-1">
          <SegmentedControl options={OFFICES} value={currentOffice} onChange={onOfficeChange} size="sm" />
        </div>
      )}
    </header>
  );
}
