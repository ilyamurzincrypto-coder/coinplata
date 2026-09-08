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
import { HelpCircle } from "lucide-react";
import ListTab from "./counterparties/ListTab.jsx";
import ObligationsTab from "./counterparties/ObligationsTab.jsx";
import { useTranslation } from "../i18n/translations.jsx";

const TABS = [
  { id: "list", key: "cp_tab_list", component: ListTab },
  { id: "obligations", key: "cp_tab_obligations", component: ObligationsTab },
];

export default function CounterpartiesPage({ onOpenHelp = null }) {
  const { t } = useTranslation();
  const [active, setActive] = useState("list");
  const ActiveComponent = TABS.find((x) => x.id === active)?.component || ListTab;

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-3.5 pb-10">
      {/* Шапка эталона: заголовок и сводка слева, вкладки справа на одной
          линии. Сводку рисует сама вкладка «Список» — только она знает
          счётчики; здесь остаётся место под неё. */}
      <div className="flex items-end gap-5 flex-wrap mb-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] leading-[1.05]">
              {t("cp_title")}
            </h1>
            {onOpenHelp && (
              <button
                type="button"
                onClick={() => onOpenHelp({ sectionId: "counterparties" })}
                title="Справка по разделу «Контрагенты»"
                className="inline-flex items-center justify-center w-7 h-7 rounded-full text-muted-soft hover:text-ink hover:bg-cream-2 transition-colors"
              >
                <HelpCircle className="w-4 h-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
          {active !== "list" && (
            <p className="text-[13px] text-muted mt-1.5">{t("cp_subtitle")}</p>
          )}
        </div>

        <div className="sm:ml-auto flex gap-1.5 shrink-0 order-first sm:order-none w-full sm:w-auto">
          {TABS.map((tab) => {
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={`px-[18px] py-2.5 rounded-full font-medium whitespace-nowrap border transition-colors ${
                  isActive
                    ? "bg-dark text-cream border-transparent"
                    : "border-transparent text-ink-soft hover:bg-cream-2"
                }`}
              >
                {t(tab.key)}
              </button>
            );
          })}
        </div>
      </div>

      <ActiveComponent />
    </main>
  );
}
