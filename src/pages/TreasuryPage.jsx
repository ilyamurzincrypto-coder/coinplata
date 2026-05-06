// src/pages/TreasuryPage.jsx
//
// Раздел «Казначейство» — три вкладки: Ностро, Лоро, Капитал.
// Структура и стилистика 1:1 повторяют CounterpartiesPage.

import React, { useState } from "react";
import { Landmark, Building2, Wallet } from "lucide-react";
import NostroTab from "./treasury/NostroTab.jsx";
import LoroTab from "./treasury/LoroTab.jsx";
import CapitalTab from "./treasury/CapitalTab.jsx";
import { useTranslation } from "../i18n/translations.jsx";

const TABS = [
  { id: "nostro", key: "tr_tab_nostro", icon: Landmark, component: NostroTab },
  { id: "loro", key: "tr_tab_loro", icon: Building2, component: LoroTab },
  { id: "capital", key: "tr_tab_capital", icon: Wallet, component: CapitalTab },
];

export default function TreasuryPage() {
  const { t } = useTranslation();
  const [active, setActive] = useState("nostro");
  const ActiveComponent = TABS.find((x) => x.id === active)?.component || NostroTab;

  return (
    <main className="max-w-[1300px] mx-auto px-6 py-6 space-y-5">
      <div>
        <h1 className="text-[24px] font-bold tracking-tight">{t("tr_title")}</h1>
        <p className="text-[13px] text-slate-500 mt-1">{t("tr_subtitle")}</p>
      </div>

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
