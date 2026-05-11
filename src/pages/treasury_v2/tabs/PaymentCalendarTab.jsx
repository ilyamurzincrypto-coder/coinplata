// src/pages/treasury_v2/tabs/PaymentCalendarTab.jsx
// «Платёжный календарь» — open obligations (deferred deal legs we still owe to clients)
// bucketed by due date: overdue / today / next 7 days / later / no date. Read-only;
// closing an obligation happens from the dashboard widget «Открытые обязательства» or
// «Контрагенты → обязательства». Source: operations.v_open_deals (useOpenObligations).
import React, { useMemo } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useOpenObligations } from "../../../store/openObligations.js";
import { bucketObligations, PC_BUCKETS, obligationLegTotals } from "../../../lib/treasury/paymentCalendar.js";

const fmtNum = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const BUCKET_STYLE = {
  overdue: "bg-rose-50 text-rose-700 border-rose-200",
  today: "bg-amber-50 text-amber-800 border-amber-200",
  week: "bg-sky-50 text-sky-700 border-sky-200",
  later: "bg-slate-50 text-slate-600 border-slate-200",
  no_date: "bg-slate-50 text-slate-500 border-slate-200",
};
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB") : "—");

export default function PaymentCalendarTab({ officeFilter }) {
  const { t } = useTranslation();
  const { items, loading } = useOpenObligations();
  const filtered = useMemo(
    () => (items || []).filter((it) => !officeFilter || officeFilter === "all" || !it.office_id || it.office_id === officeFilter),
    [items, officeFilter]
  );
  const buckets = useMemo(() => bucketObligations(filtered), [filtered]);
  const total = filtered.length;

  if (loading) return <div className="bg-white rounded-[14px] border border-slate-200/70 px-4 py-8 text-center text-[12.5px] text-slate-400">…</div>;
  if (total === 0) return <div className="bg-white rounded-[14px] border border-slate-200/70 px-4 py-8 text-center text-[12.5px] text-slate-400">{t("trv2_cal_empty")}</div>;

  return (
    <div className="space-y-3">
      {PC_BUCKETS.map((k) => {
        const rows = buckets[k];
        if (rows.length === 0) return null;
        return (
          <section key={k} className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
            <header className={`px-4 py-2 border-b text-[12px] font-bold flex items-center justify-between ${BUCKET_STYLE[k]}`}>
              <span>{t(`trv2_cal_${k}`)}</span>
              <span className="text-[11px] font-medium opacity-80">{t("trv2_cal_count").replace("{n}", String(rows.length))}</span>
            </header>
            <table className="w-full text-[12px]">
              <tbody>
                {rows.map((it) => (
                  <tr key={it.id} className="border-t border-slate-100">
                    <td className="px-4 py-1.5 text-slate-500 w-24 tabular-nums">{fmtDate(it.due_date)}</td>
                    <td className="px-2 py-1.5 text-slate-700">{it.counterparty_name || "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">
                      {obligationLegTotals(it).map((lt, i) => (
                        <span key={lt.currency}>{i > 0 ? " · " : ""}{fmtNum(lt.amount)} {lt.currency}</span>
                      ))}
                    </td>
                    <td className="px-2 py-1.5 text-right text-[10px] uppercase tracking-wider text-slate-400 w-20">{it.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      <p className="text-[11px] text-slate-400">{t("trv2_cal_note")}</p>
    </div>
  );
}
