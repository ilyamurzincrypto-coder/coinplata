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

import React from "react";
import { HelpCircle } from "lucide-react";
import ListTab from "./counterparties/ListTab.jsx";
import { useTranslation } from "../i18n/translations.jsx";

// Вкладку «Обязательства» из раздела убрали по решению владельца. Компонент
// (counterparties/ObligationsTab.jsx) НЕ удалён: он рабочий, со своим
// шестинаправленным фильтром, и понадобится, когда для долгов найдётся своё
// место. Удалять его сейчас значило бы выбросить работу ради одной строки.

export default function CounterpartiesPage({ onOpenHelp = null }) {
  const { t } = useTranslation();

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-3.5 pb-10">
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
        </div>
      </div>

      <ListTab />
    </main>
  );
}
