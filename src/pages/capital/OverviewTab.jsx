// src/pages/capital/OverviewTab.jsx
//
// Контейнер «Обзор» с тремя суб-табами:
//   • Сводка — KPI/sparkline/topN (бывшая OverviewTab, переименована в OverviewSummary)
//   • По офисам — раньше top-level таб ByOfficeTab
//   • По менеджерам — раньше top-level таб ByManagerTab
//
// CapitalPage больше не показывает ByOffice/ByManager как отдельные top-level
// табы — они здесь, чтобы общая навигация Капитала была короче.

import React, { useState } from "react";
import { LayoutDashboard, Building2, Users } from "lucide-react";
import OverviewSummary from "./OverviewSummary.jsx";
import ByOfficeTab from "./ByOfficeTab.jsx";
import ByManagerTab from "./ByManagerTab.jsx";
import { useTranslation } from "../../i18n/translations.jsx";

const SUB_TABS = [
  { id: "summary", key: "overview_sub_summary", icon: LayoutDashboard, component: OverviewSummary },
  { id: "office", key: "tab_by_office", icon: Building2, component: ByOfficeTab },
  { id: "manager", key: "tab_by_manager", icon: Users, component: ByManagerTab },
];

export default function OverviewTab({ range, onRangeChange }) {
  const { t } = useTranslation();
  const [active, setActive] = useState("summary");
  const ActiveComponent =
    SUB_TABS.find((x) => x.id === active)?.component || OverviewSummary;

  return (
    <div className="space-y-4">
      <div className="bg-slate-50 border border-slate-200 rounded-[10px] p-0.5 inline-flex gap-0.5">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12.5px] font-semibold transition-colors ${
                isActive
                  ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? "text-emerald-600" : "text-slate-400"}`} />
              {t(tab.key)}
            </button>
          );
        })}
      </div>
      <ActiveComponent range={range} onRangeChange={onRangeChange} />
    </div>
  );
}
