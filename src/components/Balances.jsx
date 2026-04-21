// src/components/Balances.jsx
import React, { useMemo } from "react";
import { Wallet, TrendingUp, TrendingDown, Layers } from "lucide-react";
import SegmentedControl from "./ui/SegmentedControl.jsx";
import { CURRENCIES, OFFICES, BALANCES_BY_OFFICE, officeName } from "../store/data.js";
import { useTranslation } from "../i18n/translations.jsx";
import { fmt, curSymbol } from "../utils/money.js";

export default function Balances({ currentOffice, scope, onScopeChange }) {
  const { t } = useTranslation();

  const displayed = useMemo(() => {
    if (scope === "selected") return BALANCES_BY_OFFICE[currentOffice];
    const agg = {};
    CURRENCIES.forEach((c) => {
      let total = 0;
      let totalPrev = 0;
      OFFICES.forEach((o) => {
        const b = BALANCES_BY_OFFICE[o.id][c];
        total += b.amount;
        totalPrev += (b.prevAmount ?? b.amount);
      });
      const change = totalPrev > 0 ? +(((total - totalPrev) / totalPrev) * 100).toFixed(1) : 0;
      agg[c] = { amount: total, prevAmount: totalPrev, change };
    });
    return agg;
  }, [scope, currentOffice]);

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
          const b = displayed[c];
          if (!b) return null;
          const up = b.change >= 0;
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
                <span
                  className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                    up ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50"
                  }`}
                >
                  {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                  {up ? "+" : ""}
                  {b.change}%
                </span>
              </div>
              <div className="text-[20px] font-semibold tracking-tight tabular-nums text-slate-900">
                <span className="text-slate-400 text-[14px] font-medium mr-0.5">{curSymbol(c)}</span>
                {fmt(b.amount, c)}
              </div>
              {b.prevAmount !== undefined && (
                <div className="mt-1.5 flex items-center gap-1 text-[11px] tabular-nums">
                  <span
                    className={`font-semibold ${
                      up ? "text-emerald-600" : b.amount === b.prevAmount ? "text-slate-400" : "text-rose-600"
                    }`}
                  >
                    {up && b.amount !== b.prevAmount ? "+" : ""}
                    {curSymbol(c)}
                    {fmt(Math.abs(b.amount - b.prevAmount), c)}
                  </span>
                  <span className="text-slate-400">{t("growth_yesterday")}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
