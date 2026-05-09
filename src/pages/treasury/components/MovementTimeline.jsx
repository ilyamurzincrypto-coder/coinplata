// src/pages/treasury/components/MovementTimeline.jsx
import React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";

function relativeTime(t, isoTimestamp) {
  if (!isoTimestamp) return "";
  const ts = new Date(isoTimestamp).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return t("tr_timeline_relative_now");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t("tr_timeline_relative_minutes").replace("{n}", String(diffMin));
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t("tr_timeline_relative_hours").replace("{n}", String(diffHr));
  const diffDay = Math.floor(diffHr / 24);
  return t("tr_timeline_relative_days").replace("{n}", String(diffDay));
}

export default function MovementTimeline({ items }) {
  const { t } = useTranslation();
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-[13px] font-bold text-slate-900">{t("tr_timeline_section_title")}</h3>
      </header>
      {items.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12.5px] text-slate-400">
          {t("tr_timeline_empty")}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((m) => {
            const isIn = m.direction === "in";
            const Icon = isIn ? ArrowDown : ArrowUp;
            return (
              <li key={m.id} className="px-4 py-2.5 flex items-center gap-3 text-[12.5px]">
                <span className="text-slate-400 w-20 shrink-0">{relativeTime(t, m.timestamp)}</span>
                <Icon className={`w-3.5 h-3.5 shrink-0 ${isIn ? "text-emerald-500" : "text-rose-500"}`} />
                <span className="flex-1 truncate font-medium text-slate-900">{m.accountName}</span>
                <span className={`tabular-nums ${isIn ? "text-emerald-600" : "text-rose-600"}`}>
                  {isIn ? "+" : "−"}{Number(m.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {m.currency}
                </span>
                {m.source?.kind && (
                  <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider hidden md:inline">
                    {m.source.kind}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
