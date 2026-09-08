// src/pages/treasury_v2/tabs/StatementsTab.jsx
//
// «Счета и выписки» — обёртка над четырьмя существующими вкладками: Активы,
// Пассивы, Капитал, Начальные остатки. Их содержимое НЕ трогали: раздел лишь
// собирает четыре точки входа в одну, чтобы верхняя панель осталась короткой.
//
// Подтабы, а не аккордеон: у каждой вкладки своя тяжёлая таблица, и держать их
// смонтированными разом значит считать четыре дерева на каждый рендер.

import React, { useState } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import AssetsTab from "./AssetsTab.jsx";
import LiabilitiesTab from "./LiabilitiesTab.jsx";
import EquityTab from "./EquityTab.jsx";
import OpeningInventoryTab from "./OpeningInventoryTab.jsx";

const SUB = [
  { id: "assets", labelKey: "trv2_tab_assets", component: AssetsTab },
  { id: "liabilities", labelKey: "trv2_tab_liabilities", component: LiabilitiesTab },
  { id: "equity", labelKey: "trv2_tab_equity", component: EquityTab },
  { id: "opening", labelKey: "trv2_tab_opening", component: OpeningInventoryTab },
];

export default function StatementsTab({ initialSub = "assets", ...props }) {
  const { t } = useTranslation();
  const [sub, setSub] = useState(() => (SUB.some((s) => s.id === initialSub) ? initialSub : "assets"));
  const Active = SUB.find((s) => s.id === sub)?.component || AssetsTab;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 flex-wrap">
        {SUB.map((s) => {
          const on = sub === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSub(s.id)}
              className={`px-4 py-2 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${
                on ? "bg-surface text-ink border border-line-2" : "text-ink-soft border border-transparent hover:bg-cream-2"
              }`}
            >
              {t(s.labelKey)}
            </button>
          );
        })}
      </div>
      <Active {...props} />
    </div>
  );
}
