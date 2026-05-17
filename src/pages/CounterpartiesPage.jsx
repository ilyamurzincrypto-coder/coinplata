// src/pages/CounterpartiesPage.jsx
//
// Top-level раздел «Контрагенты» — единая точка для клиентов и партнёров.
// Раньше:
//   • Clients — отдельная страница (LTV, профили клиентов)
//   • Counterparties — обёртка над PartnersTab (ровно тот же CRUD что в Settings)
//   • Obligations — отдельная страница с 6-направленным flow-фильтром
// Сейчас:
//   • Список — слитые клиенты + партнёры с chip-фильтром по типу
//   • Обязательства — таб с тем же flow-фильтром, контент 1:1 со старой
//     ObligationsPage
//
// CRUD счетов партнёров остаётся в Settings → Партнёры (на 2.1 это ок;
// унифицированный профиль партнёра — в шаге 2.2).

import React, { useState } from "react";
import { Users2, Scale, HelpCircle } from "lucide-react";
import ListTab from "./counterparties/ListTab.jsx";
import ObligationsTab from "./counterparties/ObligationsTab.jsx";
import { useTranslation } from "../i18n/translations.jsx";

const TABS = [
  { id: "list", key: "cp_tab_list", icon: Users2, component: ListTab },
  { id: "obligations", key: "cp_tab_obligations", icon: Scale, component: ObligationsTab },
];

export default function CounterpartiesPage({ onOpenHelp = null }) {
  const { t } = useTranslation();
  const [active, setActive] = useState("list");
  const ActiveComponent = TABS.find((x) => x.id === active)?.component || ListTab;

  return (
    <main className="max-w-[1300px] mx-auto px-6 py-6 space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-[24px] font-bold tracking-tight">{t("cp_title")}</h1>
          {onOpenHelp && (
            <button
              type="button"
              onClick={() => onOpenHelp({ sectionId: "counterparties" })}
              title="Справка по разделу «Контрагенты»"
              className="inline-flex items-center justify-center w-7 h-7 rounded-full text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
            >
              <HelpCircle className="w-4 h-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
        <p className="text-[13px] text-slate-500 mt-1">{t("cp_subtitle")}</p>
      </div>

      {/* Tab strip — общий паттерн с TreasuryShell */}
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

      <ActiveComponent />
    </main>
  );
}
