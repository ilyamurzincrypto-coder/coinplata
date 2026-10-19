// src/pages/treasury_v2/tabs/StatementsTab.jsx
//
// «Счета и выписки» — единый реестр счетов + начальные остатки.
//
// 🔴 УБРАНЫ ВКЛАДКИ «АКТИВЫ», «ПАССИВЫ», «КАПИТАЛ». Это были три ОТДЕЛЬНЫХ компонента на 1471
// строку, показывавшие одни и те же счета по-разному: у «Активов» колонка офиса, у «Капитала»
// своя «с учётом P&L», у «Пассивов» третий набор колонок. Канон CoinPay прямо запрещает такое:
// Лоро, Ностро и кассы, Капитал обязаны выглядеть ИДЕНТИЧНО — один компонент, один набор
// колонок, различаются только данные строк. Теперь это «Реестр» с переключателем разделов.
//
// Инструменты убранных вкладок НЕ потеряны: поиск, «Ненулевые», CSV, «+ Счёт в план» и карточка
// счёта перенесены в «Реестр». Чинить вид ценой работы — плохой размен.
//
// «Начальные остатки» остались: это не ещё один вид тех же счетов, а инструмент ввода.

import React, { useState } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import OpeningInventoryTab from "./OpeningInventoryTab.jsx";
import RegisterTab from "./RegisterTab.jsx";
import TurnoverTab from "./TurnoverTab.jsx";

const SUB = [
  { id: "register", labelKey: "trv2_tab_register", component: RegisterTab },
  { id: "turnover", labelKey: "trv2_tab_turnover", component: TurnoverTab },
  { id: "opening", labelKey: "trv2_tab_opening", component: OpeningInventoryTab },
];

export default function StatementsTab({ initialSub = "register", ...props }) {
  const { t } = useTranslation();
  const [sub, setSub] = useState(() => (SUB.some((s) => s.id === initialSub) ? initialSub : "register"));
  const Active = SUB.find((s) => s.id === sub)?.component || RegisterTab;

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
