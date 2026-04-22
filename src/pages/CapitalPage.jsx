// src/pages/CapitalPage.jsx
// Новый Capital — табы: Overview / Cashflow / Income-Expense / By office / By manager
// Дата-range общий на всю страницу, хранится в state здесь.

import React, { useState } from "react";
import { Briefcase, TrendingUp, Receipt, Building2, Users, Wallet, History } from "lucide-react";
import DateRangePicker, { rangeForPreset } from "../components/ui/DateRangePicker.jsx";
import OverviewTab from "./capital/OverviewTab.jsx";
import CashflowTab from "./capital/CashflowTab.jsx";
import IncomeExpenseTab from "./capital/IncomeExpenseTab.jsx";
import ByOfficeTab from "./capital/ByOfficeTab.jsx";
import ByManagerTab from "./capital/ByManagerTab.jsx";
import PnlTab from "./capital/PnlTab.jsx";
import RateHistoryTab from "./capital/RateHistoryTab.jsx";
import { useTranslation } from "../i18n/translations.jsx";

const TABS = [
  { id: "overview", key: "tab_overview", icon: Briefcase, component: OverviewTab },
  { id: "pnl", key: "tab_pnl", icon: Wallet, component: PnlTab },
  { id: "cashflow", key: "tab_cashflow", icon: TrendingUp, component: CashflowTab },
  { id: "ie", key: "tab_income_expense", icon: Receipt, component: IncomeExpenseTab },
  { id: "office", key: "tab_by_office", icon: Building2, component: ByOfficeTab },
  { id: "manager", key: "tab_by_manager", icon: Users, component: ByManagerTab },
  { id: "rate_history", key: "tab_rate_history", icon: History, component: RateHistoryTab },
];

export default function CapitalPage() {
  const { t } = useTranslation();
  const [active, setActive] = useState("overview");
  // Default — week
  const [range, setRange] = useState(() => {
    const r = rangeForPreset("week");
    return { preset: "week", ...r };
  });

  const ActiveComponent = TABS.find((x) => x.id === active)?.component || OverviewTab;

  return (
    <main className="max-w-[1300px] mx-auto px-6 py-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight">{t("capital_title")}</h1>
          <p className="text-[13px] text-slate-500 mt-1">Financial overview across all offices</p>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {/* Tab strip */}
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-1 flex gap-0.5 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[13px] font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? "text-emerald-400" : "text-slate-400"}`} />
              {t(tab.key)}
            </button>
          );
        })}
      </div>

      <ActiveComponent range={range} onRangeChange={setRange} />
    </main>
  );
}
