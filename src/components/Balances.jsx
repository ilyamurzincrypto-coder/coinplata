// src/components/Balances.jsx
// Отображает балансы по офисам/валютам.
// Данные идут из useAccounts().balanceOf() — агрегируем по валюте.
// TODO: growth "vs yesterday" временно убран — нет snapshot-системы. Вернём после rates/balances history.

import React, { useMemo } from "react";
import { Wallet, Layers } from "lucide-react";
import SegmentedControl from "./ui/SegmentedControl.jsx";
import { CURRENCIES, OFFICES, officeName } from "../store/data.js";
import { useAccounts } from "../store/accounts.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { fmt, curSymbol } from "../utils/money.js";

export default function Balances({ currentOffice, scope, onScopeChange }) {
  const { t } = useTranslation();
  const { accounts, balanceOf } = useAccounts();

  // Собираем балансы {currency → amount}: или для currentOffice, или по всем офисам
  const displayed = useMemo(() => {
    const agg = {};
    CURRENCIES.forEach((c) => (agg[c] = 0));

    const relevantAccounts = accounts.filter((a) => {
      if (!a.active) return false;
      if (scope === "selected") return a.officeId === currentOffice;
      return true;
    });

    relevantAccounts.forEach((a) => {
      if (CURRENCIES.includes(a.currency)) {
        agg[a.currency] = (agg[a.currency] || 0) + balanceOf(a.id);
      }
    });

    return agg;
  }, [scope, currentOffice, accounts, balanceOf]);

  return (
    <section>
      <div className="flex items-end justify-between mb-3 gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-3.5 h-3.5 text-slate-400" />
            <h2 className="text-[11px] font-semibold text-slate-500 tracking-widest uppercase">
              {t("balances")}
            </h2>
          </div>
          <div className="text-[13px] text-slate-600 font-medium">
            {scope === "selected"
              ? officeName(currentOffice)
              : `${t("all_offices")} · ${OFFICES.length}`}
          </div>
        </div>
        <SegmentedControl
          options={[
            { id: "selected", name: t("selected_office") },
            { id: "all", name: t("all_offices") },
          ]}
          value={scope}
          onChange={onScopeChange}
          size="sm"
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        {CURRENCIES.map((c) => {
          const amount = displayed[c] || 0;
          return (
            <div
              key={`${c}-${scope}-${currentOffice}`}
              className="bg-white rounded-[12px] border border-slate-200/70 p-4 hover:border-slate-300 transition-all"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-slate-500 tracking-[0.15em]">{c}</span>
                  {scope === "all" && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-0.5 rounded-[4px] bg-slate-100 text-slate-500">
                      <Layers className="w-2 h-2" /> AGG
                    </span>
                  )}
                </div>
              </div>
              <div className="text-[20px] font-semibold tracking-tight tabular-nums text-slate-900">
                <span className="text-slate-400 text-[14px] font-medium mr-0.5">{curSymbol(c)}</span>
                {fmt(amount, c)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
