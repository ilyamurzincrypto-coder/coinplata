// src/components/DealTemplatesBar.jsx
// Компактный ряд chip-buttons с популярными парами валют. По клику вызывает
// onApply({from, to}) — внутри ExchangeForm устанавливает curIn и создаёт
// output с target currency. Top-N из localStorage (user-local usage counter).

import React, { useMemo, useState, useEffect } from "react";
import { Zap, ArrowRight } from "lucide-react";
import { getTopTemplates } from "../utils/dealTemplates.js";

export default function DealTemplatesBar({ onApply, currentFrom, currentTo }) {
  const [tick, setTick] = useState(0);
  // Re-read localStorage при mount (для случая когда в другой вкладке обновилось)
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "coinplata.dealUsage") setTick((t) => t + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const templates = useMemo(() => getTopTemplates(6), [tick]);

  if (!templates || templates.length === 0) return null;

  return (
    <div className="px-5 pt-3 pb-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1">
          <Zap className="w-3 h-3 text-amber-500" />
          Quick
        </div>
        {templates.map((tpl) => {
          const active = currentFrom === tpl.from && currentTo === tpl.to;
          return (
            <button
              key={`${tpl.from}_${tpl.to}`}
              type="button"
              onClick={() => onApply?.(tpl)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-[8px] text-[11px] font-semibold transition-colors border ${
                active
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
              title={tpl.count > 0 ? `Used ${tpl.count}×` : "Suggested"}
            >
              <span className="tabular-nums">{tpl.from}</span>
              <ArrowRight className="w-2.5 h-2.5 opacity-60" />
              <span className="tabular-nums">{tpl.to}</span>
              {tpl.count > 0 && (
                <span className={`text-[9px] font-bold ${active ? "text-white/70" : "text-slate-400"}`}>
                  ×{tpl.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
